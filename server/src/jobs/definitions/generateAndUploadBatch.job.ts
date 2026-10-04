import { Agenda } from 'agenda';
import mongoose from 'mongoose';
import { Case } from '../../models/Case';
import { Claimant } from '../../models/Claimant';
import { DisbursementBatch } from '../../models/DisbursementBatch';
import { BatchGeneratorService } from '../../services/batchGenerator.service';
import { SftpService } from '../../services/sftp.service';

export interface GenerateAndUploadBatchData {
  caseId?: string;
  format?: 'v2' | 'compact';
  requestedBy?: string;
}

export interface BatchRunSummary {
  caseId: string;
  batchId?: string;
  filename?: string;
  remotePath?: string;
  recordCount: number;
  totalAmount: number;
  uploaded: boolean;
  message?: string;
}

export interface GenerateAndUploadBatchResult {
  batchesProcessed: number;
  summaries: BatchRunSummary[];
}

export async function executeGenerateAndUploadBatch(
  data?: GenerateAndUploadBatchData
): Promise<GenerateAndUploadBatchResult> {
  let targetCases: any[] = [];

  if (data?.caseId) {
    const caseDoc = mongoose.isValidObjectId(data.caseId)
      ? (await Case.findById(data.caseId)) || (await Case.findOne({ caseId: data.caseId }))
      : await Case.findOne({ caseId: data.caseId });
    if (caseDoc) {
      targetCases = [caseDoc];
    }
  } else {
    targetCases = await Case.find({ status: { $in: ['active', 'deadline_passed'] } });
  }

  const summaries: BatchRunSummary[] = [];

  for (const caseDoc of targetCases) {
    const caseLookupIds = [caseDoc._id, caseDoc.caseId, caseDoc._id.toString()].filter(Boolean);

    // Count eligible claimants
    const eligibleCount = await Claimant.countDocuments({
      caseId: { $in: caseLookupIds },
      status: { $in: ['selected', 'deadline_expired'] }
    });

    if (eligibleCount === 0) {
      summaries.push({
        caseId: caseDoc._id.toString(),
        recordCount: 0,
        totalAmount: 0,
        uploaded: false,
        message: 'No eligible claimants pending disbursement'
      });
      continue;
    }

    try {
      // 1. Compile and spool batch
      const spoolResult = await BatchGeneratorService.compileAndSpoolCaseBatch(
        caseDoc._id.toString(),
        {
          format: data?.format || 'v2',
          requestedBy: data?.requestedBy || 'agenda_scheduler'
        }
      );

      // 2. Upload to SFTP
      const sftpService = new SftpService();
      const uploadResult = await sftpService.uploadBatch(
        spoolResult.csvPath,
        spoolResult.sha256Path
      );

      // 3. Update DisbursementBatch record to uploaded
      const batchDoc = await DisbursementBatch.findOne({ batchId: spoolResult.batchId });
      if (batchDoc) {
        batchDoc.status = 'uploaded';
        batchDoc.uploadedAt = new Date();
        await batchDoc.save();
      }

      summaries.push({
        caseId: caseDoc._id.toString(),
        batchId: spoolResult.batchId,
        filename: spoolResult.filename,
        remotePath: uploadResult.remotePath,
        recordCount: spoolResult.totalRecords,
        totalAmount: spoolResult.totalAmount,
        uploaded: true
      });
    } catch (err: any) {
      summaries.push({
        caseId: caseDoc._id.toString(),
        recordCount: eligibleCount,
        totalAmount: 0,
        uploaded: false,
        message: err.message || 'Batch generation/upload failed'
      });
    }
  }

  return {
    batchesProcessed: summaries.filter((s) => s.uploaded).length,
    summaries
  };
}

export function defineGenerateAndUploadBatch(agenda: Agenda): void {
  agenda.define(
    'sftp:generate-and-upload-batch',
    async (job: any) => {
      await executeGenerateAndUploadBatch(job.attrs?.data as GenerateAndUploadBatchData);
    },
    { concurrency: 2, lockLifetime: 120000 }
  );
}
