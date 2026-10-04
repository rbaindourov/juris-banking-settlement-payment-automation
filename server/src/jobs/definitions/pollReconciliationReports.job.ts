import { Agenda } from 'agenda';
import { Case } from '../../models/Case';
import { Claimant } from '../../models/Claimant';
import { DisbursementBatch } from '../../models/DisbursementBatch';
import { SftpService } from '../../services/sftp.service';
import { ReconciliationService, parseReconciliationReport } from '../../services/reconciliation.service';

export interface PollReconciliationReportsData {
  remoteDir?: string;
  caseId?: string;
}

export interface PollReportsSummary {
  reportName: string;
  processed: boolean;
  totalRecords: number;
  disbursedCount: number;
  rejectedCount: number;
  returnedCount: number;
  exceptionsLogged: number;
  message?: string;
}

export interface PollReconciliationReportsResult {
  reportsFound: number;
  reportsProcessed: number;
  summaries: PollReportsSummary[];
}

export async function executePollReconciliationReports(
  data?: PollReconciliationReportsData
): Promise<PollReconciliationReportsResult> {
  const sftpService = new SftpService();
  const summaries: PollReportsSummary[] = [];

  let reports: any[] = [];
  try {
    reports = await sftpService.listReports(data?.remoteDir);
  } catch (err: any) {
    console.warn('[PollReconciliationReports] SFTP list reports error:', err.message);
    return {
      reportsFound: 0,
      reportsProcessed: 0,
      summaries: []
    };
  }

  for (const report of reports) {
    try {
      const download = await sftpService.downloadReport(report.name);
      const parsed = parseReconciliationReport(download.content);

      if (!parsed.valid && parsed.records.length === 0) {
        summaries.push({
          reportName: report.name,
          processed: false,
          totalRecords: 0,
          disbursedCount: 0,
          rejectedCount: 0,
          returnedCount: 0,
          exceptionsLogged: 0,
          message: 'Invalid or empty report format'
        });
        continue;
      }

      // Determine which case this report belongs to
      let targetCaseId = data?.caseId;

      if (!targetCaseId && parsed.records.length > 0) {
        // 1. Try resolving via batchId in record
        const sampleRecord = parsed.records[0];
        if (sampleRecord.batchId) {
          const batchDoc = await DisbursementBatch.findOne({ batchId: sampleRecord.batchId });
          if (batchDoc?.caseId) {
            targetCaseId = batchDoc.caseId.toString();
          }
        }

        // 2. Try resolving via claimId lookup
        if (!targetCaseId && sampleRecord.claimId) {
          const claimantDoc = await Claimant.findOne({ claimId: sampleRecord.claimId });
          if (claimantDoc?.caseId) {
            targetCaseId = claimantDoc.caseId.toString();
          }
        }
      }

      if (!targetCaseId) {
        console.warn(`[PollReconciliationReports] Unresolvable report: unable to map batchId or claimId for ${report.name}`);
        summaries.push({
          reportName: report.name,
          processed: false,
          totalRecords: parsed.records.length,
          disbursedCount: 0,
          rejectedCount: 0,
          returnedCount: 0,
          exceptionsLogged: 0,
          message: 'Could not resolve target case for report'
        });
        continue;
      }

      const reconcileResult = await ReconciliationService.reconcileCaseStatusReport({
        caseId: targetCaseId,
        csvContent: download.content,
        reportFilename: report.name
      });

      summaries.push({
        reportName: report.name,
        processed: true,
        totalRecords: reconcileResult.totalProcessed,
        disbursedCount: reconcileResult.disbursedCount,
        rejectedCount: reconcileResult.rejectedCount,
        returnedCount: reconcileResult.returnedCount,
        exceptionsLogged: reconcileResult.exceptionsLogged
      });
    } catch (err: any) {
      summaries.push({
        reportName: report.name,
        processed: false,
        totalRecords: 0,
        disbursedCount: 0,
        rejectedCount: 0,
        returnedCount: 0,
        exceptionsLogged: 0,
        message: err.message
      });
    }
  }

  return {
    reportsFound: reports.length,
    reportsProcessed: summaries.filter((s) => s.processed).length,
    summaries
  };
}

export function definePollReconciliationReports(agenda: Agenda): void {
  agenda.define(
    'sftp:poll-reconciliation-reports',
    async (job: any) => {
      await executePollReconciliationReports(job.attrs?.data as PollReconciliationReportsData);
    },
    { concurrency: 1, lockLifetime: 120000 }
  );
}
