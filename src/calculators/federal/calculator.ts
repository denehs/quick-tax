import { FilingStatus, DeductionInfo } from '@/types'
import { DeductionsData, EstimatedPaymentsData } from '@/store/useStore'
import { 
  TaxYear,
  getFederalTaxBrackets,
  getFederalStandardDeduction,
  getFederalCapitalGainsBrackets
} from './constants'
import { calculateProgressiveTaxWithDetails, TaxBracketDetail } from '../utils/taxBrackets'
import { calculateEstimatedPaymentsWithCumulativeSchedule, type QuarterlyPaymentSchedule } from '../utils/estimatedPayments'

export interface FederalIncomeBreakdown {
  ordinaryIncome: number
  qualifiedDividends: number
  longTermCapitalGains: number
  shortTermCapitalGains: number
  // Additional detail for income components
  wages: number
  interestIncome: number
  ordinaryDividends: number
  capitalLossDeduction: number
}

export interface FederalIncomeComponents {
  wages: number
  nonQualifiedDividends: number
  interestIncome: number
  shortTermGains: number
  longTermGains: number
  qualifiedDividends: number
  capitalLossDeduction: number
  totalOrdinaryIncome: number
  ordinaryTaxableIncome: number
}

export interface FederalTaxResult {
  taxableIncome: number        // Income after deductions
  ordinaryIncomeTax: number    // Tax on wages, interest, non-qualified dividends, short-term gains
  capitalGainsTax: number      // Tax on qualified dividends and long-term capital gains
  totalTax: number             // Total tax liability (before any withholdings or payments)
  deduction: DeductionInfo     // Deduction type and amount used for federal tax calculation
  owedOrRefund: number         // Final amount owed (positive) or refunded (negative) after subtracting withholdings and estimated payments
  effectiveRate: number        // Effective tax rate as percentage
  incomeComponents: FederalIncomeComponents  // Breakdown of income components
  ordinaryTaxBrackets: TaxBracketDetail[]    // Detailed bracket calculations for ordinary income
  capitalGainsBrackets: TaxBracketDetail[]   // Detailed bracket calculations for capital gains
}

/**
 * Calculate federal income tax based on income breakdown and deductions
 * @param income - Breakdown of different income types
 * @param deductionInfo - Deduction type and amount
 * @param filingStatus - Filing status (single or marriedFilingJointly)
 * @param taxYear - Tax year for calculations
 * @param totalIncome - Total income for effective rate calculation
 * @param withholdings - Total federal withholdings
 * @param estimatedPayments - Total estimated payments made
 * @returns Federal tax calculation result
 */
export function calculateFederalTax(
  income: FederalIncomeBreakdown,
  deductionInfo: DeductionInfo,
  filingStatus: FilingStatus,
  taxYear: TaxYear,
  totalIncome: number,
  withholdings: number,
  estimatedPayments: number
): FederalTaxResult {
  // Calculate component income total (for internal calculations)
  const componentIncome = 
    income.ordinaryIncome + 
    income.qualifiedDividends + 
    income.longTermCapitalGains + 
    income.shortTermCapitalGains

  // Calculate taxable income after deductions
  const taxableIncome = Math.max(0, componentIncome - deductionInfo.amount)

  // Short-term capital gains are taxed as ordinary income
  const ordinaryIncomeForTax = income.ordinaryIncome + income.shortTermCapitalGains
  
  // Calculate ordinary taxable income (excluding qualified dividends and LTCG)
  const ordinaryTaxableIncome = Math.max(0, ordinaryIncomeForTax - deductionInfo.amount)
  
  // Calculate tax on ordinary income with bracket details
  const ordinaryTaxResult = calculateProgressiveTaxWithDetails(
    ordinaryTaxableIncome,
    getFederalTaxBrackets(taxYear, filingStatus)
  )

  // Calculate capital gains and qualified dividends tax
  // First, we need to determine how much of the deduction has been used by ordinary income
  const deductionUsedByOrdinary = Math.min(deductionInfo.amount, ordinaryIncomeForTax)
  const remainingDeduction = deductionInfo.amount - deductionUsedByOrdinary
  
  // Apply remaining deduction to capital gains and qualified dividends
  const capitalGainsAndDividends = income.qualifiedDividends + income.longTermCapitalGains
  const taxableCapitalGainsAndDividends = Math.max(0, capitalGainsAndDividends - remainingDeduction)
  
  // For capital gains tax calculation, we need to consider the stack on top of ordinary income
  // The capital gains rate depends on total taxable income
  let capitalGainsTax = 0
  const capitalGainsBrackets: TaxBracketDetail[] = []
  
  if (taxableCapitalGainsAndDividends > 0) {
    const brackets = getFederalCapitalGainsBrackets(taxYear, filingStatus)
    let remainingCapGains = taxableCapitalGainsAndDividends
    let currentIncome = ordinaryTaxableIncome // Start from where ordinary income ends
    
    for (const bracket of brackets) {
      if (remainingCapGains <= 0) break
      
      // Calculate how much room we have in this bracket
      const roomInBracket = Math.max(0, bracket.max - currentIncome)
      const taxableInThisBracket = Math.min(remainingCapGains, roomInBracket)
      
      if (taxableInThisBracket > 0) {
        const taxForBracket = taxableInThisBracket * bracket.rate
        capitalGainsTax += taxForBracket
        
        capitalGainsBrackets.push({
          bracket: { min: bracket.min, max: bracket.max, rate: bracket.rate },
          taxableInBracket: taxableInThisBracket,
          taxForBracket: Math.round(taxForBracket)
        })
      }
      
      remainingCapGains -= taxableInThisBracket
      currentIncome += taxableInThisBracket
    }
  }

  const totalTax = Math.round(ordinaryTaxResult.totalTax + capitalGainsTax)
  const owedOrRefund = totalTax - withholdings - estimatedPayments
  const effectiveRate = totalIncome > 0 ? (totalTax / totalIncome) * 100 : 0
  
  // Compute income components using the detailed breakdown
  const nonQualifiedDividends = income.ordinaryDividends - income.qualifiedDividends
  
  const incomeComponents: FederalIncomeComponents = {
    wages: income.wages,
    nonQualifiedDividends,
    interestIncome: income.interestIncome,
    shortTermGains: income.shortTermCapitalGains,
    longTermGains: income.longTermCapitalGains,
    qualifiedDividends: income.qualifiedDividends,
    capitalLossDeduction: income.capitalLossDeduction,
    totalOrdinaryIncome: income.ordinaryIncome + income.shortTermCapitalGains,
    ordinaryTaxableIncome
  }
  
  return {
    taxableIncome,
    ordinaryIncomeTax: Math.round(ordinaryTaxResult.totalTax),
    capitalGainsTax: Math.round(capitalGainsTax),
    totalTax,
    deduction: deductionInfo,
    owedOrRefund: Math.round(owedOrRefund),
    effectiveRate,
    incomeComponents,
    ordinaryTaxBrackets: ordinaryTaxResult.bracketDetails,
    capitalGainsBrackets
  }
}

// Re-export the helper function for backwards compatibility
export { getFederalStandardDeduction }

export interface EstimatedPaymentSuggestion {
  quarter: string
  dueDate: string
  amount: number
  isPaid: boolean
  isPastDue: boolean
}

export interface FederalItemizedDeductionDetails {
  propertyTax: number
  stateIncomeTax: number
  saltDeduction: number
  saltCapped: boolean
  mortgageInterest: number
  mortgageBalance: number
  mortgageLimit: number
  effectiveMortgageInterest: number
  mortgageLimited: boolean
  donations: number
  total: number
}

/**
 * Calculate federal itemized deductions with SALT cap and mortgage interest limits
 */
export function calculateFederalItemizedDeductions(
  deductions: DeductionsData,
  estimatedCAStateTax: number,
  includeCaliforniaTax: boolean
): number {
  const details = calculateFederalItemizedDeductionDetails(
    deductions,
    estimatedCAStateTax,
    includeCaliforniaTax
  )
  return details.total
}

/**
 * Calculate federal itemized deductions with detailed breakdown
 */
export function calculateFederalItemizedDeductionDetails(
  deductions: DeductionsData,
  estimatedCAStateTax: number,
  includeCaliforniaTax: boolean
): FederalItemizedDeductionDetails {
  const propertyTax = parseFloat(deductions.propertyTax) || 0
  const mortgageInterest = parseFloat(deductions.mortgageInterest) || 0
  const donations = parseFloat(deductions.donations) || 0
  const mortgageBalance = parseFloat(deductions.mortgageBalance) || 0
  
  // Calculate state income tax for SALT
  const stateIncomeTax = includeCaliforniaTax 
    ? estimatedCAStateTax
    : parseFloat(deductions.otherStateIncomeTax) || 0
  
  // Apply SALT cap ($10,000 for both single and married filing jointly)
  const saltTotal = propertyTax + stateIncomeTax
  const saltDeduction = Math.min(saltTotal, 10000)
  const saltCapped = saltTotal > 10000
  
  // Calculate mortgage interest deduction with limits
  let deductibleMortgageInterest = mortgageInterest
  let mortgageLimit = 0
  let mortgageLimited = false
  
  if (mortgageBalance > 0 && deductions.mortgageLoanDate) {
    mortgageLimit = deductions.mortgageLoanDate === 'before-dec-16-2017' ? 1000000 : 750000
    if (mortgageBalance > mortgageLimit) {
      deductibleMortgageInterest = mortgageInterest * (mortgageLimit / mortgageBalance)
      mortgageLimited = true
    }
  }
  
  return {
    propertyTax,
    stateIncomeTax,
    saltDeduction,
    saltCapped,
    mortgageInterest,
    mortgageBalance,
    mortgageLimit,
    effectiveMortgageInterest: deductibleMortgageInterest,
    mortgageLimited,
    donations,
    total: saltDeduction + deductibleMortgageInterest + donations
  }
}

/**
 * Calculate suggested federal estimated tax payments
 * Federal requires cumulative payments: Q1: 25%, Q2: 50%, Q3: 75%, Q4: 100%
 */
export function calculateFederalEstimatedPayments(
  totalTaxOwed: number,
  estimatedPayments: EstimatedPaymentsData
): EstimatedPaymentSuggestion[] {
  const paymentSchedule: QuarterlyPaymentSchedule[] = [
    { quarter: 'Q1', dueDate: 'April 15, 2025', dueDateObj: new Date('2025-04-15'), cumulativePercentage: 0.25, paid: parseFloat(estimatedPayments.federalQ1) || 0 },
    { quarter: 'Q2', dueDate: 'June 16, 2025', dueDateObj: new Date('2025-06-16'), cumulativePercentage: 0.50, paid: parseFloat(estimatedPayments.federalQ2) || 0 },
    { quarter: 'Q3', dueDate: 'September 15, 2025', dueDateObj: new Date('2025-09-15'), cumulativePercentage: 0.75, paid: parseFloat(estimatedPayments.federalQ3) || 0 },
    { quarter: 'Q4', dueDate: 'January 15, 2026', dueDateObj: new Date('2026-01-15'), cumulativePercentage: 1.00, paid: parseFloat(estimatedPayments.federalQ4) || 0 }
  ]
  
  return calculateEstimatedPaymentsWithCumulativeSchedule(totalTaxOwed, paymentSchedule)
}