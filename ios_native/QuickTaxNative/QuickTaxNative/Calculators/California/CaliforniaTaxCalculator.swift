import Foundation

class CaliforniaTaxCalculator {
    
    static func calculate(
        income: IncomeData,
        spouseIncome: IncomeData?,
        deductions: DeductionsData,
        estimatedPayments: EstimatedPaymentsData,
        filingStatus: FilingStatus
    ) -> CaliforniaTaxResult {
        
        // Step 1: Calculate total income (California treats all income the same)
        let totalIncome = calculateTotalIncome(userIncome: income, spouseIncome: spouseIncome)
        
        // Step 2: Calculate deductions
        let deductionInfo = calculateDeduction(
            deductions: deductions,
            filingStatus: filingStatus
        )
        
        // Step 3: Calculate taxable income
        let taxableIncome = max(totalIncome - deductionInfo.amount, 0)
        
        // Step 4: Calculate base tax using progressive brackets
        let taxBrackets = calculateProgressiveTax(
            income: taxableIncome,
            brackets: CaliforniaTaxConstants.TaxBrackets.brackets(for: filingStatus)
        )
        var baseTax = taxBrackets.reduce(0) { $0 + $1.taxForBracket }
        var roundedBaseTax = Decimal()
        NSDecimalRound(&roundedBaseTax, &baseTax, 0, .plain)
        
        // Step 5: Calculate mental health tax
        let mentalHealthTax = calculateMentalHealthTax(taxableIncome: taxableIncome)
        
        // Step 6: Calculate total tax
        var totalTax = roundedBaseTax + mentalHealthTax
        var roundedTotalTax = Decimal()
        NSDecimalRound(&roundedTotalTax, &totalTax, 0, .plain)
        
        // Step 7: Calculate withholding and payments
        let totalWithholding = calculateTotalWithholding(
            userIncome: income,
            spouseIncome: spouseIncome
        )
        let totalEstimatedPayments = calculateTotalEstimatedPayments(estimatedPayments)
        
        // Step 8: Calculate owed or refund
        let owedOrRefund = roundedTotalTax - totalWithholding - totalEstimatedPayments
        
        // Step 9: Calculate effective rate
        let effectiveRate = totalIncome > 0 ? roundedTotalTax / totalIncome : 0
        
        return CaliforniaTaxResult(
            taxableIncome: taxableIncome,
            baseTax: roundedBaseTax,
            mentalHealthTax: mentalHealthTax,
            totalTax: roundedTotalTax,
            deduction: deductionInfo,
            owedOrRefund: owedOrRefund,
            effectiveRate: effectiveRate,
            taxBrackets: taxBrackets
        )
    }
    
    // MARK: - Income Calculation
    
    private static func calculateTotalIncome(
        userIncome: IncomeData,
        spouseIncome: IncomeData?
    ) -> Decimal {
        
        var total: Decimal = 0
        
        // Process user income
        total += processIncome(userIncome)
        
        // Process spouse income if applicable
        if let spouseIncome = spouseIncome {
            total += processIncome(spouseIncome)
        }
        
        return total
    }
    
    private static func processIncome(_ income: IncomeData) -> Decimal {
        var total: Decimal = 0
        
        // Investment income - California treats everything as ordinary income
        total += income.investmentIncome.ordinaryDividends.toDecimal() ?? 0
        total += income.investmentIncome.interestIncome.toDecimal() ?? 0
        total += income.investmentIncome.shortTermGains.toDecimal() ?? 0
        total += income.investmentIncome.longTermGains.toDecimal() ?? 0
        
        // W2 income
        total += income.ytdW2Income.taxableWage.toDecimal() ?? 0
        
        // Future income
        total += calculateFutureWages(income)
        
        return total
    }
    
    private static func calculateFutureWages(_ income: IncomeData) -> Decimal {
        if income.incomeMode == .simple {
            return income.futureIncome.taxableWage.toDecimal() ?? 0
        } else {
            // Calculate paycheck income
            let paycheckWage = income.paycheckData.taxableWage.toDecimal() ?? 0
            let paycheckCount = calculateRemainingPaychecks(
                frequency: income.paycheckData.frequency,
                nextDate: income.paycheckData.nextPaymentDate
            )
            let paycheckTotal = paycheckWage * Decimal(paycheckCount)
            
            // NOTE: We do NOT include past RSU vest wage here
            // The web app only counts future income
            // let rsuVestWage = income.rsuVestData.taxableWage.toDecimal() ?? 0
            var futureRSUTotal: Decimal = 0
            
            for vest in income.futureRSUVests {
                if vest.date >= Date() {
                    let shares = Decimal(string: vest.shares) ?? 0
                    let price = Decimal(string: vest.expectedPrice) ?? 0
                    futureRSUTotal += shares * price
                }
            }
            
            return paycheckTotal + futureRSUTotal
        }
    }
    
    private static func calculateRemainingPaychecks(frequency: PayFrequency, nextDate: Date) -> Int {
        let calendar = Calendar.current
        let now = Date()
        let endOfYear = calendar.date(from: DateComponents(year: calendar.component(.year, from: now), month: 12, day: 31))!
        
        if nextDate > endOfYear {
            return 0
        }
        
        // Use proper date iteration logic like the web app
        var paychecksRemaining = 0
        var payDate = nextDate
        
        while payDate <= endOfYear {
            paychecksRemaining += 1
            
            switch frequency {
            case .biweekly:
                payDate = calendar.date(byAdding: .day, value: 14, to: payDate) ?? payDate
            case .monthly:
                payDate = calendar.date(byAdding: .month, value: 1, to: payDate) ?? payDate
            }
        }
        
        return paychecksRemaining
    }
    
    // MARK: - Deduction Calculation
    
    private static func calculateDeduction(
        deductions: DeductionsData,
        filingStatus: FilingStatus
    ) -> DeductionInfo {
        
        let standardDeduction = CaliforniaTaxConstants.StandardDeductions.amount(for: filingStatus)
        
        // Calculate itemized deductions
        let propertyTax = deductions.propertyTax.toDecimal() ?? 0
        
        // Calculate mortgage interest with California's $1M limit
        let mortgageInterest = deductions.mortgageInterest.toDecimal() ?? 0
        let mortgageBalance = deductions.mortgageBalance.toDecimal() ?? 0
        
        let allowedMortgageInterest: Decimal
        if mortgageBalance > 0 && mortgageBalance > CaliforniaTaxConstants.Limits.mortgageInterestLimit {
            allowedMortgageInterest = mortgageInterest * (CaliforniaTaxConstants.Limits.mortgageInterestLimit / mortgageBalance)
        } else {
            allowedMortgageInterest = mortgageInterest
        }
        
        let donations = deductions.donations.toDecimal() ?? 0
        
        // California doesn't have SALT cap and doesn't allow CA income tax deduction
        var totalItemized = propertyTax + allowedMortgageInterest + donations
        
        // Round the total itemized deductions
        var roundedTotalItemized = Decimal()
        NSDecimalRound(&roundedTotalItemized, &totalItemized, 0, .plain)
        
        // Return the higher deduction
        if roundedTotalItemized > standardDeduction {
            return DeductionInfo(type: .itemized, amount: roundedTotalItemized)
        } else {
            return DeductionInfo(type: .standard, amount: standardDeduction)
        }
    }
    
    // MARK: - Tax Calculation
    
    private static func calculateProgressiveTax(
        income: Decimal,
        brackets: [TaxBracket]
    ) -> [TaxBracketDetail] {
        
        var details: [TaxBracketDetail] = []
        var remainingIncome = income
        
        for bracket in brackets {
            if remainingIncome <= 0 {
                break
            }
            
            let bracketMax = bracket.max ?? Decimal.greatestFiniteMagnitude
            let taxableInBracket = min(remainingIncome, bracketMax - bracket.min)
            
            if taxableInBracket > 0 {
                let taxForBracket = taxableInBracket * bracket.rate
                details.append(TaxBracketDetail(
                    bracket: bracket,
                    taxableInBracket: taxableInBracket,
                    taxForBracket: taxForBracket
                ))
                remainingIncome -= taxableInBracket
            }
        }
        
        return details
    }
    
    private static func calculateMentalHealthTax(taxableIncome: Decimal) -> Decimal {
        if taxableIncome > CaliforniaTaxConstants.MentalHealthTax.threshold {
            let excessIncome = taxableIncome - CaliforniaTaxConstants.MentalHealthTax.threshold
            return (excessIncome * CaliforniaTaxConstants.MentalHealthTax.rate).rounded()
        }
        return 0
    }
    
    // MARK: - Withholding and Payments
    
    private static func calculateTotalWithholding(
        userIncome: IncomeData,
        spouseIncome: IncomeData?
    ) -> Decimal {
        
        var total: Decimal = 0
        
        // User withholding
        total += calculateIndividualWithholding(userIncome)
        
        // Spouse withholding
        if let spouseIncome = spouseIncome {
            total += calculateIndividualWithholding(spouseIncome)
        }
        
        return total
    }
    
    private static func calculateIndividualWithholding(_ income: IncomeData) -> Decimal {
        var total: Decimal = 0
        
        // YTD withholding
        total += income.ytdW2Income.stateWithhold.toDecimal() ?? 0
        
        if income.incomeMode == .simple {
            total += income.futureIncome.stateWithhold.toDecimal() ?? 0
        } else {
            // Paycheck withholding
            let paycheckWithhold = income.paycheckData.stateWithhold.toDecimal() ?? 0
            let paycheckCount = calculateRemainingPaychecks(
                frequency: income.paycheckData.frequency,
                nextDate: income.paycheckData.nextPaymentDate
            )
            total += paycheckWithhold * Decimal(paycheckCount)
            
            // NOTE: We do NOT include past RSU vest withholding here
            // The web app only counts future income withholdings
            // total += income.rsuVestData.stateWithhold.toDecimal() ?? 0
            
            // Future RSU vest withholdings
            for vest in income.futureRSUVests {
                if vest.date >= Date() {
                    let shares = Decimal(string: vest.shares) ?? 0
                    let price = Decimal(string: vest.expectedPrice) ?? 0
                    let vestValue = shares * price
                    
                    if vestValue > 0 {
                        // Calculate withholding rate from most recent RSU vest data
                        let rsuVestWage = income.rsuVestData.taxableWage.toDecimal() ?? 0
                        let rsuVestState = income.rsuVestData.stateWithhold.toDecimal() ?? 0
                        
                        if rsuVestWage > 0 {
                            let stateRate = rsuVestState / rsuVestWage
                            total += vestValue * stateRate
                        } else {
                            // Default to 10% state withholding if no historical data
                            total += vestValue * Decimal(0.10)
                        }
                    }
                }
            }
        }
        
        return total
    }
    
    private static func calculateTotalEstimatedPayments(_ payments: EstimatedPaymentsData) -> Decimal {
        return (payments.californiaQ1.toDecimal() ?? 0) +
               (payments.californiaQ2.toDecimal() ?? 0) +
               (payments.californiaQ4.toDecimal() ?? 0)
    }
}