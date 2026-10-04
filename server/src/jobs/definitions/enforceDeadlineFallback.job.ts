import { Agenda } from 'agenda';
import mongoose from 'mongoose';
import { Case } from '../../models/Case';
import { Claimant } from '../../models/Claimant';

export interface EnforceDeadlineFallbackData {
  caseId?: string;
}

export interface EnforceDeadlineFallbackResult {
  modifiedCount: number;
  casesUpdated: number;
}

/**
 * Sweeps expired cases past their disbursement deadline and assigns
 * the case's fallback payment method to unresponsive claimants.
 */
export async function executeDeadlineFallback(
  data?: EnforceDeadlineFallbackData
): Promise<EnforceDeadlineFallbackResult> {
  const now = new Date();
  let targetCases: any[] = [];

  if (data?.caseId) {
    const caseDoc = mongoose.isValidObjectId(data.caseId)
      ? (await Case.findById(data.caseId)) || (await Case.findOne({ caseId: data.caseId }))
      : await Case.findOne({ caseId: data.caseId });
    if (caseDoc && caseDoc.disbursementDeadline && new Date(caseDoc.disbursementDeadline) < now) {
      targetCases = [caseDoc];
    }
  } else {
    targetCases = await Case.find({
      disbursementDeadline: { $lt: now }
    });
  }

  let totalModified = 0;
  let casesUpdated = 0;

  for (const caseDoc of targetCases) {
    const caseLookupIds = [caseDoc._id, caseDoc.caseId, caseDoc._id.toString()].filter(Boolean);
    const fallbackMethod = (caseDoc.fallbackPaymentMethod as any) || 'physical_check';

    const pendingClaimants = await Claimant.find({
      caseId: { $in: caseLookupIds },
      status: 'pending_selection'
    });

    if (pendingClaimants.length > 0) {
      for (const claimant of pendingClaimants) {
        claimant.status = 'deadline_expired';
        claimant.selectedPaymentMethod = fallbackMethod;
        claimant.fallbackReason = 'DEADLINE_PASSED_UNRESPONSIVE';
        claimant.selectedAt = new Date();

        if (fallbackMethod === 'physical_check' && !claimant.paymentDetails) {
          claimant.paymentDetails = {
            method: 'physical_check',
            recipientName: `${claimant.firstName} ${claimant.lastName}`.trim(),
            address: claimant.address || {}
          };
        }

        await claimant.save();
        totalModified++;
      }
    }

    // Check if any claimants remain pending
    const remainingPending = await Claimant.countDocuments({
      caseId: { $in: caseLookupIds },
      status: 'pending_selection'
    });

    if (remainingPending === 0 && caseDoc.status === 'active') {
      caseDoc.status = 'deadline_passed';
      await caseDoc.save();
      casesUpdated++;
    }
  }

  return {
    modifiedCount: totalModified,
    casesUpdated
  };
}

export function defineEnforceDeadlineFallback(agenda: Agenda): void {
  agenda.define(
    'case:enforce-deadline-fallback',
    async (job: any) => {
      await executeDeadlineFallback(job.attrs?.data as EnforceDeadlineFallbackData);
    },
    { concurrency: 5, lockLifetime: 60000 }
  );
}
