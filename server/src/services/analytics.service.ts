import { Claimant, PAYMENT_RAILS } from '../models/Claimant';
import { ReconciliationException } from '../models/ReconciliationException';
import { ICase } from '../models/Case';

export const VALID_RAILS: string[] = [...PAYMENT_RAILS, 'court_fallback', 'fallback_check'];

export interface FunnelCounts {
  uploaded: number;
  dispatched: number;
  delivered: number;
  visited: number;
  selected: number;
  disbursed: number;
}

export interface FunnelRates {
  deliveryRate: number;
  clickRate: number;
  conversionRate: number;
  disbursementRate: number;
  overallConversionRate: number;
  overallDisbursementRate: number;
}

export interface FunnelDropOff {
  dispatchToDelivery: number;
  deliveryToVisit: number;
  visitToSelect: number;
  selectToDisburse: number;
}

export interface FunnelStageItem {
  stage: 'uploaded' | 'dispatched' | 'delivered' | 'visited' | 'selected' | 'disbursed';
  label: string;
  count: number;
  conversionRate: number;
  dropOffRate: number;
}

export interface FunnelAnalyticsResponse {
  caseId: string;
  caseName?: string;
  docketNumber?: string;
  uploaded: number;
  dispatched: number;
  delivered: number;
  visited: number;
  selected: number;
  disbursed: number;
  deliveryRate: number;
  clickRate: number;
  conversionRate: number;
  disbursementRate: number;
  overallConversionRate: number;
  overallDisbursementRate: number;
  stages: FunnelCounts;
  rates: FunnelRates;
  dropOff: FunnelDropOff;
  funnel: FunnelStageItem[];
}

export interface PaymentRailItem {
  method: string;
  name: string;
  count: number;
  percentage: number;
  totalAmount: number;
  totalAmountCents: number;
  totalAmountFormatted: string;
  color: string;
}

export interface PaymentMethodsAnalyticsResponse {
  caseId: string;
  totalSelected: number;
  totalAmount: number;
  totalAmountFormatted: string;
  methods: PaymentRailItem[];
}

export interface FinancialSummaryResponse {
  caseId: string;
  caseName: string;
  docketNumber: string;
  settlementFundTotal: number;
  settlementFundTotalFormatted: string;
  totalAllocated: number;
  totalAllocatedFormatted: string;
  totalClaimed: number;
  totalClaimedFormatted: string;
  totalDisbursed: number;
  totalDisbursedFormatted: string;
  totalOutstanding: number;
  totalOutstandingFormatted: string;
  remainingUnclaimedFund: number;
  remainingUnclaimedFundFormatted: string;
  fundVariance: number;
  fundVarianceFormatted: string;
  reconciliationDiscrepanciesCount: number;
  openExceptionsCount: number;
  totalExceptionsCount: number;
  totalClaimants: number;
  claimedClaimants: number;
  disbursedClaimants: number;
  disbursementProgressPercent: number;
}

export const CANONICAL_RAIL_CONFIG: Record<
  string,
  { label: string; color: string; aliases: string[] }
> = {
  ach: {
    label: 'Direct Deposit (ACH)',
    color: '#2563eb',
    aliases: ['ach', 'direct_deposit']
  },
  digital_card: {
    label: 'Digital Prepaid Card',
    color: '#7c3aed',
    aliases: ['digital_card']
  },
  debit_card: {
    label: 'Push to Debit Card',
    color: '#0284c7',
    aliases: ['debit_card', 'push_to_debit']
  },
  physical_check: {
    label: 'Mailed Physical Check',
    color: '#059669',
    aliases: ['physical_check']
  },
  paypal: {
    label: 'PayPal',
    color: '#0070ba',
    aliases: ['paypal']
  },
  venmo: {
    label: 'Venmo',
    color: '#008cff',
    aliases: ['venmo']
  },
  zelle: {
    label: 'Zelle',
    color: '#7414ca',
    aliases: ['zelle']
  },
  bitcoin: {
    label: 'Bitcoin',
    color: '#d97706',
    aliases: ['bitcoin']
  },
  court_fallback: {
    label: 'Court Fallback Check',
    color: '#64748b',
    aliases: ['court_fallback', 'fallback_check', 'fallback']
  }
};

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export class AnalyticsService {
  /**
   * Computes the 6-stage delivery funnel metrics and conversion rates.
   */
  public static async calculateFunnel(
    caseDoc: ICase,
    caseLookupIds: any[]
  ): Promise<FunnelAnalyticsResponse> {
    const aggResult = await Claimant.aggregate([
      { $match: { caseId: { $in: caseLookupIds } } },
      {
        $group: {
          _id: null,
          uploaded: { $sum: 1 },
          dispatched: {
            $sum: { $cond: [{ $eq: ['$emailSent', true] }, 1, 0] }
          },
          delivered: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$emailSent', true] },
                    { $ne: ['$bounced', true] }
                  ]
                },
                1,
                0
              ]
            }
          },
          visited: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$linkClicked', true] },
                    { $eq: ['$emailOpened', true] },
                    { $in: ['$selectedPaymentMethod', VALID_RAILS] },
                    {
                      $in: [
                        '$status',
                        ['selected', 'queued_for_sftp', 'disbursed', 'deadline_expired']
                      ]
                    }
                  ]
                },
                1,
                0
              ]
            }
          },
          selected: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $in: ['$selectedPaymentMethod', VALID_RAILS] },
                    {
                      $in: [
                        '$status',
                        ['selected', 'queued_for_sftp', 'disbursed', 'deadline_expired']
                      ]
                    }
                  ]
                },
                1,
                0
              ]
            }
          },
          disbursed: {
            $sum: {
              $cond: [{ $eq: ['$status', 'disbursed'] }, 1, 0]
            }
          }
        }
      }
    ]);

    const row = aggResult[0] || {
      uploaded: 0,
      dispatched: 0,
      delivered: 0,
      visited: 0,
      selected: 0,
      disbursed: 0
    };

    const uploaded = row.uploaded || 0;
    const dispatched = row.dispatched || 0;
    const delivered = row.delivered || 0;
    const visited = row.visited || 0;
    const selected = row.selected || 0;
    const disbursed = row.disbursed || 0;

    // Rates calculation with zero-division protection
    const deliveryRate = dispatched > 0 ? (delivered / dispatched) * 100 : 0;
    const clickRate = delivered > 0 ? (visited / delivered) * 100 : 0;
    const conversionRate = visited > 0 ? (selected / visited) * 100 : 0;
    const disbursementRate = selected > 0 ? (disbursed / selected) * 100 : 0;
    const overallConversionRate = uploaded > 0 ? (selected / uploaded) * 100 : 0;
    const overallDisbursementRate = uploaded > 0 ? (disbursed / uploaded) * 100 : 0;

    // Drop-off rates
    const dispatchToDelivery =
      dispatched > 0 ? Math.max(0, ((dispatched - delivered) / dispatched) * 100) : 0;
    const deliveryToVisit =
      delivered > 0 ? Math.max(0, ((delivered - visited) / delivered) * 100) : 0;
    const visitToSelect =
      visited > 0 ? Math.max(0, ((visited - selected) / visited) * 100) : 0;
    const selectToDisburse =
      selected > 0 ? Math.max(0, ((selected - disbursed) / selected) * 100) : 0;

    const round2 = (num: number) => Math.round(num * 100) / 100;

    const stages: FunnelCounts = {
      uploaded,
      dispatched,
      delivered,
      visited,
      selected,
      disbursed
    };

    const rates: FunnelRates = {
      deliveryRate: round2(deliveryRate),
      clickRate: round2(clickRate),
      conversionRate: round2(conversionRate),
      disbursementRate: round2(disbursementRate),
      overallConversionRate: round2(overallConversionRate),
      overallDisbursementRate: round2(overallDisbursementRate)
    };

    const dropOff: FunnelDropOff = {
      dispatchToDelivery: round2(dispatchToDelivery),
      deliveryToVisit: round2(deliveryToVisit),
      visitToSelect: round2(visitToSelect),
      selectToDisburse: round2(selectToDisburse)
    };

    const funnel: FunnelStageItem[] = [
      {
        stage: 'uploaded',
        label: 'Uploaded Claimants',
        count: uploaded,
        conversionRate: 100,
        dropOffRate: 0
      },
      {
        stage: 'dispatched',
        label: 'Notifications Dispatched',
        count: dispatched,
        conversionRate: uploaded > 0 ? round2((dispatched / uploaded) * 100) : 0,
        dropOffRate: uploaded > 0 ? round2(Math.max(0, ((uploaded - dispatched) / uploaded) * 100)) : 0
      },
      {
        stage: 'delivered',
        label: 'Emails Delivered',
        count: delivered,
        conversionRate: round2(deliveryRate),
        dropOffRate: round2(dispatchToDelivery)
      },
      {
        stage: 'visited',
        label: 'Portal Visited',
        count: visited,
        conversionRate: round2(clickRate),
        dropOffRate: round2(deliveryToVisit)
      },
      {
        stage: 'selected',
        label: 'Payment Selected',
        count: selected,
        conversionRate: round2(conversionRate),
        dropOffRate: round2(visitToSelect)
      },
      {
        stage: 'disbursed',
        label: 'Funds Disbursed',
        count: disbursed,
        conversionRate: round2(disbursementRate),
        dropOffRate: round2(selectToDisburse)
      }
    ];

    return {
      caseId: caseDoc._id.toString(),
      caseName: caseDoc.name,
      docketNumber: caseDoc.docketNumber,
      uploaded,
      dispatched,
      delivered,
      visited,
      selected,
      disbursed,
      deliveryRate: round2(deliveryRate),
      clickRate: round2(clickRate),
      conversionRate: round2(conversionRate),
      disbursementRate: round2(disbursementRate),
      overallConversionRate: round2(overallConversionRate),
      overallDisbursementRate: round2(overallDisbursementRate),
      stages,
      rates,
      dropOff,
      funnel
    };
  }

  /**
   * Computes the distribution of payment method selections across all 9 payment rails.
   */
  public static async calculateMethodDistribution(
    caseDoc: ICase,
    caseLookupIds: any[]
  ): Promise<PaymentMethodsAnalyticsResponse> {
    const claimants = await Claimant.find({
      caseId: { $in: caseLookupIds },
      $or: [
        { selectedPaymentMethod: { $exists: true, $ne: null } },
        { fallbackReason: { $exists: true, $ne: null } },
        { status: { $in: ['selected', 'queued_for_sftp', 'disbursed', 'deadline_expired'] } }
      ]
    }).select('selectedPaymentMethod fallbackReason status settlementAmount');

    // Aggregate counts and amounts per canonical rail
    const railTotals: Record<string, { count: number; amount: number }> = {};
    for (const key of Object.keys(CANONICAL_RAIL_CONFIG)) {
      railTotals[key] = { count: 0, amount: 0 };
    }

    for (const c of claimants) {
      let rail = 'court_fallback';

      if (c.fallbackReason || c.status === 'deadline_expired') {
        rail = 'court_fallback';
      } else if (c.selectedPaymentMethod) {
        const method = c.selectedPaymentMethod.toLowerCase();
        if (method === 'ach' || method === 'direct_deposit') {
          rail = 'ach';
        } else if (method === 'debit_card' || method === 'push_to_debit') {
          rail = 'debit_card';
        } else if (method === 'digital_card') {
          rail = 'digital_card';
        } else if (method === 'physical_check') {
          rail = 'physical_check';
        } else if (method === 'paypal') {
          rail = 'paypal';
        } else if (method === 'venmo') {
          rail = 'venmo';
        } else if (method === 'zelle') {
          rail = 'zelle';
        } else if (method === 'bitcoin') {
          rail = 'bitcoin';
        } else if (method === 'court_fallback' || method === 'fallback_check') {
          rail = 'court_fallback';
        }
      }

      if (!railTotals[rail]) {
        railTotals[rail] = { count: 0, amount: 0 };
      }
      railTotals[rail].count += 1;
      railTotals[rail].amount += c.settlementAmount || 0;
    }

    const totalSelected = Object.values(railTotals).reduce((sum, item) => sum + item.count, 0);
    const totalAmount = Math.round(
      Object.values(railTotals).reduce((sum, item) => sum + item.amount, 0) * 100
    ) / 100;

    const methods: PaymentRailItem[] = Object.entries(CANONICAL_RAIL_CONFIG).map(
      ([railKey, meta]) => {
        const data = railTotals[railKey] || { count: 0, amount: 0 };
        const percentage =
          totalSelected > 0 ? Math.round((data.count / totalSelected) * 10000) / 100 : 0;
        const totalAmountCents = Math.round(data.amount * 100);
        return {
          method: railKey,
          name: meta.label,
          count: data.count,
          percentage,
          totalAmount: Math.round(data.amount * 100) / 100,
          totalAmountCents,
          totalAmountFormatted: formatCurrency(data.amount),
          color: meta.color
        };
      }
    );

    return {
      caseId: caseDoc._id.toString(),
      totalSelected,
      totalAmount,
      totalAmountFormatted: formatCurrency(totalAmount),
      methods
    };
  }

  /**
   * Computes the comprehensive case financial summary and reconciliation discrepancies.
   */
  public static async calculateFinancialSummary(
    caseDoc: ICase,
    caseLookupIds: any[]
  ): Promise<FinancialSummaryResponse> {
    const [claimantAgg, openExceptionsCount, totalExceptionsCount] = await Promise.all([
      Claimant.aggregate([
        { $match: { caseId: { $in: caseLookupIds } } },
        {
          $group: {
            _id: null,
            totalAllocated: { $sum: { $ifNull: ['$settlementAmount', 0] } },
            totalClaimed: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $in: ['$selectedPaymentMethod', VALID_RAILS] },
                      {
                        $in: [
                          '$status',
                          ['selected', 'queued_for_sftp', 'disbursed', 'deadline_expired']
                        ]
                      }
                    ]
                  },
                  { $ifNull: ['$settlementAmount', 0] },
                  0
                ]
              }
            },
            totalDisbursed: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'disbursed'] },
                  { $ifNull: ['$settlementAmount', 0] },
                  0
                ]
              }
            },
            totalClaimants: { $sum: 1 },
            claimedClaimants: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $in: ['$selectedPaymentMethod', VALID_RAILS] },
                      {
                        $in: [
                          '$status',
                          ['selected', 'queued_for_sftp', 'disbursed', 'deadline_expired']
                        ]
                      }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            disbursedClaimants: {
              $sum: {
                $cond: [{ $eq: ['$status', 'disbursed'] }, 1, 0]
              }
            }
          }
        }
      ]),
      ReconciliationException.countDocuments({
        caseId: { $in: caseLookupIds },
        resolved: false
      }),
      ReconciliationException.countDocuments({
        caseId: { $in: caseLookupIds }
      })
    ]);

    const aggData = claimantAgg[0] || {
      totalAllocated: 0,
      totalClaimed: 0,
      totalDisbursed: 0,
      totalClaimants: 0,
      claimedClaimants: 0,
      disbursedClaimants: 0
    };

    const settlementFundTotal = caseDoc.settlementFundTotal || 0;
    const totalAllocated = Math.round(aggData.totalAllocated * 100) / 100;
    const totalClaimed = Math.round(aggData.totalClaimed * 100) / 100;
    const totalDisbursed = Math.round(aggData.totalDisbursed * 100) / 100;
    const totalOutstanding = Math.round((settlementFundTotal - totalDisbursed) * 100) / 100;
    const remainingUnclaimedFund = Math.round((settlementFundTotal - totalClaimed) * 100) / 100;
    const fundVariance = Math.round((totalAllocated - settlementFundTotal) * 100) / 100;

    const disbursementProgressPercent =
      aggData.totalClaimants > 0
        ? Math.round((aggData.disbursedClaimants / aggData.totalClaimants) * 10000) / 100
        : 0;

    return {
      caseId: caseDoc._id.toString(),
      caseName: caseDoc.name,
      docketNumber: caseDoc.docketNumber,
      settlementFundTotal,
      settlementFundTotalFormatted: formatCurrency(settlementFundTotal),
      totalAllocated,
      totalAllocatedFormatted: formatCurrency(totalAllocated),
      totalClaimed,
      totalClaimedFormatted: formatCurrency(totalClaimed),
      totalDisbursed,
      totalDisbursedFormatted: formatCurrency(totalDisbursed),
      totalOutstanding,
      totalOutstandingFormatted: formatCurrency(totalOutstanding),
      remainingUnclaimedFund,
      remainingUnclaimedFundFormatted: formatCurrency(remainingUnclaimedFund),
      fundVariance,
      fundVarianceFormatted: formatCurrency(fundVariance),
      reconciliationDiscrepanciesCount: openExceptionsCount,
      openExceptionsCount,
      totalExceptionsCount,
      totalClaimants: aggData.totalClaimants,
      claimedClaimants: aggData.claimedClaimants,
      disbursedClaimants: aggData.disbursedClaimants,
      disbursementProgressPercent
    };
  }
}
