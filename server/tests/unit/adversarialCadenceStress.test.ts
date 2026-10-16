import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import {
  NotificationCadence,
  EmailWave,
  SubBatch,
  SuppressionList,
  Case
} from '../../src/models';
import {
  timeStringSchema,
  cadenceThrottlingSchema,
  cadenceStageConfigSchema,
  createCadenceSchema,
  pauseWaveSchema,
  resumeWaveSchema,
  rescheduleWaveSchema,
  cancelWaveSchema,
  createSuppressionSchema,
  objectIdSchema,
  waveIdParamSchema
} from '../../src/validation/cadence.validation';

describe('Adversarial Stress Test: Milestone 1 Data Models & Zod Validation', () => {
  let testCaseId: mongoose.Types.ObjectId;
  let otherCaseId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    await setupTestDb('adversarial_cadence_stress');
  });

  afterAll(async () => {
    await teardownTestDb('adversarial_cadence_stress');
  });

  beforeEach(async () => {
    await clearTestDb('adversarial_cadence_stress');

    testCaseId = new mongoose.Types.ObjectId();
    otherCaseId = new mongoose.Types.ObjectId();

    await Case.create({
      _id: testCaseId,
      name: 'Adversarial Test Case 1',
      docketNumber: '1:26-cv-99991',
      lawFirmId: 'FIRM-ADV-1',
      settlementFundTotal: 500000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 60),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });

    await Case.create({
      _id: otherCaseId,
      name: 'Adversarial Test Case 2',
      docketNumber: '1:26-cv-99992',
      lawFirmId: 'FIRM-ADV-2',
      settlementFundTotal: 250000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 60),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });
  });

  // =========================================================================
  // PART 1: COMPOUND UNIQUE INDEX INTEGRITY STRESS TESTS
  // =========================================================================
  describe('Part 1: Compound Unique Index Integrity (Mongoose / Native MongoDB)', () => {
    describe('1.1 NotificationCadence: Unique caseId Index Integrity', () => {
      it('unconditionally throws E11000 duplicate key error on duplicate caseId', async () => {
        // Document 1
        const doc1 = await NotificationCadence.create({
          caseId: testCaseId,
          lawFirmId: 'FIRM-ADV-1',
          name: 'Cadence A'
        });
        expect(doc1._id).toBeDefined();

        // Document 2 with identical caseId (even with different lawFirmId and name)
        let thrownError: any = null;
        try {
          await NotificationCadence.create({
            caseId: testCaseId,
            lawFirmId: 'FIRM-ADV-2',
            name: 'Cadence B - Duplicate Attempt'
          });
        } catch (err: any) {
          thrownError = err;
        }

        expect(thrownError).not.toBeNull();
        expect(thrownError.code).toBe(11000);
        expect(thrownError.message).toMatch(/E11000 duplicate key error/);
        expect(thrownError.keyPattern).toEqual({ caseId: 1 });
      });

      it('survives concurrent race-condition creation on caseId with exactly one winner', async () => {
        const results = await Promise.allSettled([
          NotificationCadence.create({ caseId: testCaseId, lawFirmId: 'FIRM-ADV-1', name: 'Race 1' }),
          NotificationCadence.create({ caseId: testCaseId, lawFirmId: 'FIRM-ADV-1', name: 'Race 2' }),
          NotificationCadence.create({ caseId: testCaseId, lawFirmId: 'FIRM-ADV-1', name: 'Race 3' })
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');

        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(2);
        for (const rej of rejected) {
          const reason = (rej as PromiseRejectedResult).reason;
          expect(reason.code).toBe(11000);
          expect(reason.message).toMatch(/E11000/);
        }
      });

      it('allows independent cadences across different caseIds', async () => {
        const doc1 = await NotificationCadence.create({
          caseId: testCaseId,
          lawFirmId: 'FIRM-ADV-1'
        });
        const doc2 = await NotificationCadence.create({
          caseId: otherCaseId,
          lawFirmId: 'FIRM-ADV-2'
        });
        expect(doc1._id).toBeDefined();
        expect(doc2._id).toBeDefined();
        expect(doc1.caseId.toString()).not.toBe(doc2.caseId.toString());
      });
    });

    describe('1.2 SubBatch: Unique { waveId, chunkIndex } Index Integrity', () => {
      let wave1Id: mongoose.Types.ObjectId;
      let wave2Id: mongoose.Types.ObjectId;

      beforeEach(async () => {
        const wave1 = await EmailWave.create({
          waveId: 'WAVE-ADV-001',
          caseId: testCaseId,
          stage: 'initial_notice',
          scheduledDate: new Date()
        });
        const wave2 = await EmailWave.create({
          waveId: 'WAVE-ADV-002',
          caseId: testCaseId,
          stage: 'reminder_14d',
          scheduledDate: new Date()
        });
        wave1Id = wave1._id as mongoose.Types.ObjectId;
        wave2Id = wave2._id as mongoose.Types.ObjectId;
      });

      it('unconditionally throws E11000 duplicate key error on duplicate { waveId, chunkIndex }', async () => {
        await SubBatch.create({
          subBatchId: 'SB-W1-C0',
          waveId: wave1Id,
          caseId: testCaseId,
          chunkIndex: 0,
          totalChunks: 5,
          scheduledAt: new Date()
        });

        let thrownError: any = null;
        try {
          await SubBatch.create({
            subBatchId: 'SB-W1-C0-ATTEMPT2',
            waveId: wave1Id,
            caseId: testCaseId,
            chunkIndex: 0, // Duplicate chunkIndex 0 on wave1
            totalChunks: 5,
            scheduledAt: new Date()
          });
        } catch (err: any) {
          thrownError = err;
        }

        expect(thrownError).not.toBeNull();
        expect(thrownError.code).toBe(11000);
        expect(thrownError.message).toMatch(/E11000 duplicate key error/);
        expect(thrownError.keyPattern).toEqual({ waveId: 1, chunkIndex: 1 });
      });

      it('allows different chunkIndex values on the same waveId', async () => {
        const sb0 = await SubBatch.create({
          subBatchId: 'SB-W1-CHUNK-0',
          waveId: wave1Id,
          caseId: testCaseId,
          chunkIndex: 0,
          totalChunks: 3,
          scheduledAt: new Date()
        });
        const sb1 = await SubBatch.create({
          subBatchId: 'SB-W1-CHUNK-1',
          waveId: wave1Id,
          caseId: testCaseId,
          chunkIndex: 1,
          totalChunks: 3,
          scheduledAt: new Date()
        });
        const sb2 = await SubBatch.create({
          subBatchId: 'SB-W1-CHUNK-2',
          waveId: wave1Id,
          caseId: testCaseId,
          chunkIndex: 2,
          totalChunks: 3,
          scheduledAt: new Date()
        });

        expect(sb0._id).toBeDefined();
        expect(sb1._id).toBeDefined();
        expect(sb2._id).toBeDefined();
      });

      it('allows identical chunkIndex on distinct waveIds', async () => {
        const sbWave1Chunk0 = await SubBatch.create({
          subBatchId: 'SB-W1-C0-OK',
          waveId: wave1Id,
          caseId: testCaseId,
          chunkIndex: 0,
          totalChunks: 2,
          scheduledAt: new Date()
        });
        const sbWave2Chunk0 = await SubBatch.create({
          subBatchId: 'SB-W2-C0-OK',
          waveId: wave2Id,
          caseId: testCaseId,
          chunkIndex: 0, // Same chunkIndex 0, but different waveId
          totalChunks: 2,
          scheduledAt: new Date()
        });

        expect(sbWave1Chunk0._id).toBeDefined();
        expect(sbWave2Chunk0._id).toBeDefined();
      });

      it('enforces uniqueness on subBatchId across all batches', async () => {
        await SubBatch.create({
          subBatchId: 'SB-GLOBAL-UNIQUE-ID',
          waveId: wave1Id,
          caseId: testCaseId,
          chunkIndex: 0,
          totalChunks: 2,
          scheduledAt: new Date()
        });

        let thrownError: any = null;
        try {
          await SubBatch.create({
            subBatchId: 'SB-GLOBAL-UNIQUE-ID', // Duplicate subBatchId
            waveId: wave2Id,
            caseId: testCaseId,
            chunkIndex: 1,
            totalChunks: 2,
            scheduledAt: new Date()
          });
        } catch (err: any) {
          thrownError = err;
        }

        expect(thrownError).not.toBeNull();
        expect(thrownError.code).toBe(11000);
        expect(thrownError.keyPattern).toEqual({ subBatchId: 1 });
      });

      it('survives concurrent race-condition creation on { waveId, chunkIndex }', async () => {
        const attempts = Array.from({ length: 5 }, (_, i) =>
          SubBatch.create({
            subBatchId: `SB-RACE-${i}`,
            waveId: wave1Id,
            caseId: testCaseId,
            chunkIndex: 0,
            totalChunks: 2,
            scheduledAt: new Date()
          })
        );

        const results = await Promise.allSettled(attempts);
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');

        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(4);
        for (const rej of rejected) {
          expect((rej as PromiseRejectedResult).reason.code).toBe(11000);
        }
      });
    });

    describe('1.3 SuppressionList: Unique { email, caseId } Index Integrity', () => {
      it('unconditionally throws E11000 duplicate key error on duplicate { email, caseId }', async () => {
        await SuppressionList.create({
          email: 'adversarial.claimant@domain.com',
          caseId: testCaseId,
          reason: 'bounced',
          source: 'smtp_rejection'
        });

        let thrownError: any = null;
        try {
          await SuppressionList.create({
            email: 'ADVERSARIAL.CLAIMANT@DOMAIN.COM', // Uppercase variation (normalized)
            caseId: testCaseId,
            reason: 'opt_out',
            source: 'admin_manual'
          });
        } catch (err: any) {
          thrownError = err;
        }

        expect(thrownError).not.toBeNull();
        expect(thrownError.code).toBe(11000);
        expect(thrownError.message).toMatch(/E11000 duplicate key error/);
        expect(thrownError.keyPattern).toEqual({ email: 1, caseId: 1 });
      });

      it('unconditionally throws E11000 on duplicate global platform suppressions { email, caseId: null }', async () => {
        await SuppressionList.create({
          email: 'global.spam@platform.com',
          caseId: null,
          reason: 'complaint'
        });

        let thrownError: any = null;
        try {
          await SuppressionList.create({
            email: 'global.spam@platform.com',
            caseId: null, // Duplicate global suppression
            reason: 'bounced'
          });
        } catch (err: any) {
          thrownError = err;
        }

        expect(thrownError).not.toBeNull();
        expect(thrownError.code).toBe(11000);
        expect(thrownError.keyPattern).toEqual({ email: 1, caseId: 1 });
      });

      it('allows identical email to exist in different case scopes and global scope without collision', async () => {
        // Global suppression
        const globalEntry = await SuppressionList.create({
          email: 'multi.scope@domain.com',
          caseId: null,
          reason: 'bounced'
        });

        // Case 1 suppression
        const case1Entry = await SuppressionList.create({
          email: 'multi.scope@domain.com',
          caseId: testCaseId,
          reason: 'opt_out'
        });

        // Case 2 suppression
        const case2Entry = await SuppressionList.create({
          email: 'multi.scope@domain.com',
          caseId: otherCaseId,
          reason: 'complaint'
        });

        expect(globalEntry._id).toBeDefined();
        expect(case1Entry._id).toBeDefined();
        expect(case2Entry._id).toBeDefined();

        const count = await SuppressionList.countDocuments({ email: 'multi.scope@domain.com' });
        expect(count).toBe(3);
      });

      it('survives concurrent race-condition creation on { email, caseId }', async () => {
        const attempts = Array.from({ length: 5 }, () =>
          SuppressionList.create({
            email: 'race.bounce@target.com',
            caseId: testCaseId,
            reason: 'bounced'
          })
        );

        const results = await Promise.allSettled(attempts);
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');

        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(4);
        for (const rej of rejected) {
          expect((rej as PromiseRejectedResult).reason.code).toBe(11000);
        }
      });
    });
  });

  // =========================================================================
  // PART 2: ZOD VALIDATION STRESS TESTING (EDGE CASES & MALICIOUS PAYLOADS)
  // =========================================================================
  describe('Part 2: Zod Validation Stress Testing', () => {
    describe('2.1 Quiet Hours & 24-Hour Time String Validation (timeStringSchema)', () => {
      const invalidTimes = [
        '24:00', // Hour 24 is invalid (00-23 only)
        '25:00', // Hour 25
        '12:60', // Minute 60 is invalid (00-59 only)
        '12:99',
        '9:00', // Missing leading zero
        '09:0', // Missing trailing minute digit
        '09:5',
        '-01:00', // Negative hour
        '22:00:00', // 3 components (HH:mm:ss not allowed)
        '22:00 PM', // 12-hour format with meridian
        '22:00\n', // Newline suffix
        '\n22:00', // Newline prefix
        '22:00; DROP TABLE users;', // SQL injection payload
        '<script>alert(1)</script>', // XSS payload
        '   22:00   ', // Untrimmed whitespace
        '', // Empty string
        'abc', // Non-numeric
        '::',
        '22',
        'null',
        'undefined'
      ];

      for (const time of invalidTimes) {
        it(`strictly rejects invalid quiet hours time: "${time}"`, () => {
          const result = timeStringSchema.safeParse(time);
          expect(result.success).toBe(false);
        });
      }

      const validTimes = ['00:00', '07:30', '12:00', '22:00', '23:59'];
      for (const time of validTimes) {
        it(`accepts valid 24-hour time: "${time}"`, () => {
          const result = timeStringSchema.safeParse(time);
          expect(result.success).toBe(true);
        });
      }
    });

    describe('2.2 Throttling Configuration Edge Cases (cadenceThrottlingSchema)', () => {
      it('strictly rejects negative, zero, and boundary-exceeding batchSize', () => {
        expect(cadenceThrottlingSchema.safeParse({ batchSize: 0 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ batchSize: -1 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ batchSize: -500 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ batchSize: 10001 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ batchSize: 1000000 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ batchSize: 50.5 }).success).toBe(false); // Float rejected
        expect(cadenceThrottlingSchema.safeParse({ batchSize: '500' as any }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ batchSize: NaN }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ batchSize: Infinity }).success).toBe(false);
      });

      it('strictly rejects negative, zero, and boundary-exceeding intervalMinutes', () => {
        expect(cadenceThrottlingSchema.safeParse({ intervalMinutes: 0 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ intervalMinutes: -1 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ intervalMinutes: -15 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ intervalMinutes: 1441 }).success).toBe(false); // Exceeds 24h
        expect(cadenceThrottlingSchema.safeParse({ intervalMinutes: 15.5 }).success).toBe(false);
      });

      it('strictly rejects negative, zero, and boundary-exceeding rateLimitPerSecond', () => {
        expect(cadenceThrottlingSchema.safeParse({ rateLimitPerSecond: 0 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ rateLimitPerSecond: -1 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ rateLimitPerSecond: 101 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ rateLimitPerSecond: 500 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ rateLimitPerSecond: 25.5 }).success).toBe(false);
      });

      it('strictly rejects negative and boundary-exceeding dailyCap', () => {
        expect(cadenceThrottlingSchema.safeParse({ dailyCap: -1 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ dailyCap: 1000001 }).success).toBe(false);
        expect(cadenceThrottlingSchema.safeParse({ dailyCap: 5000.5 }).success).toBe(false);
      });

      it('strictly rejects invalid quiet hours inside throttling config', () => {
        expect(
          cadenceThrottlingSchema.safeParse({
            quietHoursEnabled: true,
            quietHoursStart: '25:00',
            quietHoursEnd: '07:00'
          }).success
        ).toBe(false);

        expect(
          cadenceThrottlingSchema.safeParse({
            quietHoursEnabled: true,
            quietHoursStart: '22:00',
            quietHoursEnd: '12:60'
          }).success
        ).toBe(false);
      });
    });

    describe('2.3 Stage Configuration Corruptions (cadenceStageConfigSchema)', () => {
      const validTemplate = {
        en: {
          subject: 'Court Notice: Action Required',
          bodyHtml: '<p>Dear {{claimant_first_name}}, amount: {{settlement_amount}}.</p>'
        }
      };

      it('strictly rejects unauthorized or corrupted stageKey enums', () => {
        const corruptedKeys = [
          'invalid_stage_key',
          'initial_notice_2',
          'hacked_stage',
          '',
          '__proto__',
          'constructor',
          123,
          null
        ];

        for (const key of corruptedKeys) {
          const result = cadenceStageConfigSchema.safeParse({
            stageKey: key,
            templates: validTemplate
          });
          expect(result.success).toBe(false);
        }
      });

      it('strictly rejects unauthorized triggerType', () => {
        const result = cadenceStageConfigSchema.safeParse({
          stageKey: 'initial_notice',
          triggerType: 'magic_ai_trigger' as any,
          templates: validTemplate
        });
        expect(result.success).toBe(false);
      });

      it('strictly rejects triggerType "date_fixed" when fixedDate is missing', () => {
        const result = cadenceStageConfigSchema.safeParse({
          stageKey: 'initial_notice',
          triggerType: 'date_fixed',
          // fixedDate missing
          templates: validTemplate
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          const issue = result.error.issues.find((i) => i.path.includes('fixedDate'));
          expect(issue).toBeDefined();
          expect(issue?.message).toContain('fixedDate is required when triggerType is "date_fixed"');
        }
      });

      it('strictly rejects triggerType "date_fixed" when fixedDate is unparseable', () => {
        const result = cadenceStageConfigSchema.safeParse({
          stageKey: 'initial_notice',
          triggerType: 'date_fixed',
          fixedDate: 'not-a-valid-date-string',
          templates: validTemplate
        });
        expect(result.success).toBe(false);
      });

      it('strictly rejects non-integer offsetHours', () => {
        const result = cadenceStageConfigSchema.safeParse({
          stageKey: 'reminder_14d',
          offsetHours: 14.5,
          templates: validTemplate
        });
        expect(result.success).toBe(false);
      });

      it('strictly rejects missing English (en) template', () => {
        const result = cadenceStageConfigSchema.safeParse({
          stageKey: 'initial_notice',
          templates: {
            es: { subject: 'Hola', bodyHtml: '<p>Cuerpo</p>' }
            // en missing
          }
        });
        expect(result.success).toBe(false);
      });

      it('strictly rejects empty or oversized subject and empty bodyHtml', () => {
        // Empty subject
        expect(
          cadenceStageConfigSchema.safeParse({
            stageKey: 'initial_notice',
            templates: {
              en: { subject: '', bodyHtml: '<p>Content</p>' }
            }
          }).success
        ).toBe(false);

        // Subject exceeding 255 chars
        expect(
          cadenceStageConfigSchema.safeParse({
            stageKey: 'initial_notice',
            templates: {
              en: { subject: 'a'.repeat(256), bodyHtml: '<p>Content</p>' }
            }
          }).success
        ).toBe(false);

        // Empty bodyHtml
        expect(
          cadenceStageConfigSchema.safeParse({
            stageKey: 'initial_notice',
            templates: {
              en: { subject: 'Valid Subject', bodyHtml: '' }
            }
          }).success
        ).toBe(false);
      });

      it('vulnerability finding: localizedEmailTemplateSchema allows whitespace-only subject due to .min(1).trim() ordering', () => {
        const result = cadenceStageConfigSchema.safeParse({
          stageKey: 'initial_notice',
          templates: {
            en: { subject: '   ', bodyHtml: '<p>Content</p>' }
          }
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.templates.en.subject).toBe('');
        }
      });
    });

    describe('2.4 Template Merge Tag Behavior Analysis', () => {
      it('verifies that templates with valid merge tags parse cleanly', () => {
        const result = cadenceStageConfigSchema.safeParse({
          stageKey: 'initial_notice',
          templates: {
            en: {
              subject: 'Action: {{claimant_first_name}} - {{settlement_amount}}',
              bodyHtml:
                '<p>Dear {{claimant_first_name}}, amount: {{settlement_amount}}, deadline: {{selection_deadline}}, link: <a href="{{payment_selection_link}}">Claim</a></p>'
            }
          }
        });
        expect(result.success).toBe(true);
      });

      it('empirically records that Zod schema permits templates without merge tags (handled at runtime)', () => {
        // Empirical finding: localizedEmailTemplateSchema checks string presence and length.
        // It does not reject templates without merge tags (e.g. static general announcements),
        // delegating dynamic tag replacement to template.service.ts.
        const plainTemplateResult = cadenceStageConfigSchema.safeParse({
          stageKey: 'initial_notice',
          templates: {
            en: {
              subject: 'Court Settlement Notice',
              bodyHtml: '<p>Please check your mail for physical settlement instructions.</p>'
            }
          }
        });

        expect(plainTemplateResult.success).toBe(true);
      });
    });

    describe('2.5 createCadenceSchema Boundary Rejections', () => {
      it('strictly rejects payload with empty stages array', () => {
        const result = createCadenceSchema.safeParse({
          stages: [] // Min 1 required
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('At least one stage configuration is required');
        }
      });

      it('strictly rejects payload missing stages entirely', () => {
        const result = createCadenceSchema.safeParse({});
        expect(result.success).toBe(false);
      });

      it('strictly rejects name exceeding 100 characters', () => {
        const result = createCadenceSchema.safeParse({
          name: 'x'.repeat(101),
          stages: [
            {
              stageKey: 'initial_notice',
              templates: { en: { subject: 'Sub', bodyHtml: 'Body' } }
            }
          ]
        });
        expect(result.success).toBe(false);
      });
    });

    describe('2.6 Wave Operational Controls Zod Rejections & Edge Cases', () => {
      it('pauseWaveSchema: rejects reasons exceeding 500 characters', () => {
        expect(pauseWaveSchema.safeParse({ reason: 'a'.repeat(501) }).success).toBe(false);
        expect(pauseWaveSchema.safeParse({ reason: 'a'.repeat(500) }).success).toBe(true);
      });

      it('resumeWaveSchema: rejects invalid newIntervalMinutes', () => {
        expect(resumeWaveSchema.safeParse({ newIntervalMinutes: 0 }).success).toBe(false);
        expect(resumeWaveSchema.safeParse({ newIntervalMinutes: -10 }).success).toBe(false);
        expect(resumeWaveSchema.safeParse({ newIntervalMinutes: 1441 }).success).toBe(false);
        expect(resumeWaveSchema.safeParse({ newIntervalMinutes: 15.5 }).success).toBe(false);
        expect(resumeWaveSchema.safeParse({ newIntervalMinutes: 30 }).success).toBe(true);
      });

      it('rescheduleWaveSchema: strictly rejects past dates and invalid dates', () => {
        // Past date
        const pastDate = new Date(Date.now() - 3600000);
        const pastResult = rescheduleWaveSchema.safeParse({
          newScheduledDate: pastDate
        });
        expect(pastResult.success).toBe(false);
        if (!pastResult.success) {
          expect(pastResult.error.issues[0].message).toContain('New scheduled date must be in the future');
        }

        // Invalid date string
        expect(rescheduleWaveSchema.safeParse({ newScheduledDate: 'invalid-date-string' }).success).toBe(false);

        // Future date passes
        const futureDate = new Date(Date.now() + 86400000);
        expect(rescheduleWaveSchema.safeParse({ newScheduledDate: futureDate }).success).toBe(true);
      });

      it('cancelWaveSchema: strictly rejects empty reason and reasons exceeding 500 characters', () => {
        expect(cancelWaveSchema.safeParse({ reason: '' }).success).toBe(false);
        expect(cancelWaveSchema.safeParse({ reason: 'a'.repeat(501) }).success).toBe(false);
        expect(cancelWaveSchema.safeParse({ reason: 'Legitimate cancellation reason' }).success).toBe(true);
      });

      it('vulnerability finding: cancelWaveSchema allows whitespace-only strings due to .min(1).trim() chaining order', () => {
        // Empirical flaw: .min(1) executes on raw string '   ' (len 3 >= 1), then .trim() turns it into ''
        const result = cancelWaveSchema.safeParse({ reason: '   ' });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.reason).toBe('');
        }
      });
    });

    describe('2.7 Suppression Validation Edge Cases (createSuppressionSchema)', () => {
      const maliciousEmails = [
        'invalid-email',
        '@no-user.com',
        'user@',
        'user@domain',
        'user@.com',
        'user name@domain.com',
        'user@domain..com',
        'a'.repeat(250) + '@domain.com', // Exceeds 255 chars
        '<script>alert(1)</script>@domain.com',
        'user@domain.com\n',
        '\r\nuser@domain.com'
      ];

      for (const email of maliciousEmails) {
        it(`strictly rejects invalid email format: "${email}"`, () => {
          const result = createSuppressionSchema.safeParse({
            email,
            reason: 'bounced'
          });
          expect(result.success).toBe(false);
        });
      }

      it('strictly rejects unauthorized suppression reasons', () => {
        const result = createSuppressionSchema.safeParse({
          email: 'valid@example.com',
          reason: 'unauthorized_reason_hack' as any
        });
        expect(result.success).toBe(false);
      });

      it('strictly rejects non-ObjectId caseId', () => {
        const invalidObjectIds = [
          'not-an-object-id',
          '12345',
          '66000000000000000000000z', // Invalid hex char 'z'
          '../etc/passwd',
          "' OR '1'='1"
        ];

        for (const badId of invalidObjectIds) {
          const result = createSuppressionSchema.safeParse({
            email: 'valid@example.com',
            reason: 'bounced',
            caseId: badId
          });
          expect(result.success).toBe(false);
        }
      });

      it('normalizes valid lowercase/uppercase emails', () => {
        const result = createSuppressionSchema.safeParse({
          email: 'Claimant.User+Tag@DOMAIN.COM',
          reason: 'bounced'
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.email).toBe('claimant.user+tag@domain.com');
        }
      });

      it('vulnerability finding: normalizedEmailSchema rejects untrimmed emails because .email() precedes .transform()', () => {
        // Empirical flaw: .email() runs on raw untrimmed string '  user@domain.com  ', failing before .transform()
        const result = createSuppressionSchema.safeParse({
          email: '   claimant@domain.com   ',
          reason: 'bounced'
        });
        expect(result.success).toBe(false);
      });
    });

    describe('2.8 Route Parameter Schemas (objectIdSchema & waveIdParamSchema)', () => {
      it('objectIdSchema strictly rejects non-24 hex character strings', () => {
        expect(objectIdSchema.safeParse('123').success).toBe(false);
        expect(objectIdSchema.safeParse('66000000000000000000000').success).toBe(false); // 23 chars
        expect(objectIdSchema.safeParse('6600000000000000000000001').success).toBe(false); // 25 chars
        expect(objectIdSchema.safeParse('66000000000000000000000g').success).toBe(false); // 'g' non-hex
        expect(objectIdSchema.safeParse(new mongoose.Types.ObjectId().toHexString()).success).toBe(true);
      });

      it('waveIdParamSchema strictly rejects empty wave IDs', () => {
        expect(waveIdParamSchema.safeParse({ waveId: '' }).success).toBe(false);
        expect(waveIdParamSchema.safeParse({ waveId: 'WAVE-101' }).success).toBe(true);
      });

      it('vulnerability finding: waveIdParamSchema allows whitespace-only waveId due to .min(1).trim() ordering', () => {
        // Empirical flaw: .min(1) passes on '   ' (len 3 >= 1), then .trim() turns it into ''
        const result = waveIdParamSchema.safeParse({ waveId: '   ' });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.waveId).toBe('');
        }
      });
    });
  });
});
