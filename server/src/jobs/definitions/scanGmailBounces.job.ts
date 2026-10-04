import { Agenda } from 'agenda';
import { Claimant } from '../../models/Claimant';
import { GmailService } from '../../services/gmailService';

export interface ScanGmailBouncesData {
  limit?: number;
}

export interface ScanGmailBouncesResult {
  scanned: number;
  bouncesDetected: number;
  updatedClaimantCount: number;
  healthy: boolean;
  message?: string;
}

/**
 * Sweeps the Gmail workspace inbox for DSN delivery status bounce notifications,
 * identifying delivery failures and marking claimant records as bounced.
 */
export async function executeScanGmailBounces(
  data?: ScanGmailBouncesData
): Promise<ScanGmailBouncesResult> {
  const limit = data?.limit || 25;

  // 1. Health check with fail-open safety
  const isHealthy = await GmailService.isHealthy();
  if (!isHealthy) {
    return {
      scanned: 0,
      bouncesDetected: 0,
      updatedClaimantCount: 0,
      healthy: false,
      message: 'Gmail service is unreachable; skipping bounce scan cleanly (fail-open)'
    };
  }

  // 2. Trigger scan
  try {
    const scanResponse = await GmailService.scanBounces(limit);

    if (!scanResponse.success || !scanResponse.data) {
      return {
        scanned: 0,
        bouncesDetected: 0,
        updatedClaimantCount: 0,
        healthy: true,
        message: scanResponse.error || 'Bounce scan returned unsuccessful response'
      };
    }

    const { scanned = 0, bouncesDetected = 0, newBounces = [] } = scanResponse.data;
    let updatedClaimantCount = 0;

    for (const bounce of newBounces) {
      if (!bounce.recipient) continue;

      const normEmail = bounce.recipient.toLowerCase().trim();
      const updateResult = await Claimant.updateMany(
        { email: normEmail, bounced: { $ne: true } },
        {
          $set: {
            bounced: true,
            bouncedAt: new Date(),
            bounceReason:
              bounce.diagnosticMessage ||
              bounce.bounceType ||
              'DSN bounce detected via Gmail service scan'
          }
        }
      );

      updatedClaimantCount += updateResult.modifiedCount || 0;
    }

    return {
      scanned,
      bouncesDetected,
      updatedClaimantCount,
      healthy: true
    };
  } catch (err: any) {
    return {
      scanned: 0,
      bouncesDetected: 0,
      updatedClaimantCount: 0,
      healthy: true,
      message: err.message
    };
  }
}

export function defineScanGmailBounces(agenda: Agenda): void {
  agenda.define(
    'email:scan-gmail-bounces',
    async (job: any) => {
      await executeScanGmailBounces(job.attrs?.data as ScanGmailBouncesData);
    },
    { concurrency: 1, lockLifetime: 60000 }
  );
}
