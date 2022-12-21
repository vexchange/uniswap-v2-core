import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'
import { BigNumber, bigNumberify, defaultAbiCoder, hexZeroPad, keccak256, toUtf8Bytes } from 'ethers/utils'
import { AddressZero } from 'ethers/constants'
import {
  expandTo18Decimals,
  mineBlock,
  encodePrice,
  MAX_UINT_104,
  MAX_UINT_128,
  MAX_UINT_256,
  bigNumberSqrt, closeTo
} from './shared/utilities'
import { pairFixture } from './shared/fixtures'

const MINIMUM_LIQUIDITY = bigNumberify(10).pow(3)

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('ConstantProductPair', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet, other] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let factory: Contract
  let token0: Contract
  let token1: Contract
  let token2: Contract
  let pair: Contract
  let recoverer: string
  beforeEach(async () => {
    const fixture = await loadFixture(pairFixture)
    factory = fixture.factory
    token0 = fixture.token0
    token1 = fixture.token1
    token2 = fixture.token2
    pair = fixture.pair
    recoverer = fixture.recoverer
  })

  it('mint', async () => {
    const token0Amount = expandTo18Decimals(1)
    const token1Amount = expandTo18Decimals(4)
    await token0.transfer(pair.address, token0Amount)
    await token1.transfer(pair.address, token1Amount)

    const expectedLiquidity = expandTo18Decimals(2)
    await expect(pair.mint(wallet.address, overrides))
      .to.emit(pair, 'Transfer')
      .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
      .to.emit(pair, 'Transfer')
      .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(pair, 'Sync')
      .withArgs(token0Amount, token1Amount)
      .to.emit(pair, 'Mint')
      .withArgs(wallet.address, token0Amount, token1Amount)

    expect(await pair.totalSupply()).to.eq(expectedLiquidity)
    expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    expect(await token0.balanceOf(pair.address)).to.eq(token0Amount)
    expect(await token1.balanceOf(pair.address)).to.eq(token1Amount)
    const reserves = await pair.getReserves()
    expect(reserves[0]).to.eq(token0Amount)
    expect(reserves[1]).to.eq(token1Amount)
  })

  async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
    await token0.transfer(pair.address, token0Amount)
    await token1.transfer(pair.address, token1Amount)
    await pair.mint(wallet.address, overrides)
  }
  const swapTestCases: BigNumber[][] = [
    [1, 5, 10, '1662497915624478906'],
    [1, 10, 5, '453305446940074565'],

    [2, 5, 10, '2851015155847869602'],
    [2, 10, 5, '831248957812239453'],

    [1, 10, 10, '906610893880149131'],
    [1, 100, 100, '987158034397061298'],
    [1, 1000, 1000, '996006981039903216']
  ].map(a => a.map(n => (typeof n === 'string' ? bigNumberify(n) : expandTo18Decimals(n))))
  swapTestCases.forEach((swapTestCase, i) => {
    it(`getInputPrice:${i}`, async () => {
      const [swapAmount, token0Amount, token1Amount, expectedOutputAmount] = swapTestCase
      await addLiquidity(token0Amount, token1Amount)
      await token0.transfer(pair.address, swapAmount.add(1))

      const balanceBefore = await token1.balanceOf(wallet.address)
      await pair.swap(swapAmount, true, wallet.address, '0x', overrides)
      const balanceAfter = await token1.balanceOf(wallet.address)
      expect(balanceAfter.sub(balanceBefore)).to.eq(expectedOutputAmount)
    })
  })

  it('swap:token0', async () => {
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0Amount, token1Amount)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = bigNumberify('1662497915624478906')
    await token0.transfer(pair.address, swapAmount)
    await expect(pair.swap(swapAmount, true, wallet.address, '0x', overrides))
      .to.emit(token1, 'Transfer')
      .withArgs(pair.address, wallet.address, expectedOutputAmount)
      .to.emit(pair, 'Sync')
      .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
      .to.emit(pair, 'Swap')
      .withArgs(wallet.address, true, swapAmount, expectedOutputAmount, wallet.address)

    const reserves = await pair.getReserves()
    expect(reserves[0]).to.eq(token0Amount.add(swapAmount))
    expect(reserves[1]).to.eq(token1Amount.sub(expectedOutputAmount))
    expect(await token0.balanceOf(pair.address)).to.eq(token0Amount.add(swapAmount))
    expect(await token1.balanceOf(pair.address)).to.eq(token1Amount.sub(expectedOutputAmount))
    const totalSupplyToken0 = await token0.totalSupply()
    const totalSupplyToken1 = await token1.totalSupply()
    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(token0Amount).sub(swapAmount))
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(token1Amount).add(expectedOutputAmount))
  })

  it('swap:token1', async () => {
    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0Amount, token1Amount)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = bigNumberify('453305446940074565')
    await token1.transfer(pair.address, swapAmount)
    await expect(pair.swap(swapAmount.mul(-1), true, wallet.address, '0x', overrides))
      .to.emit(token0, 'Transfer')
      .withArgs(pair.address, wallet.address, expectedOutputAmount)
      .to.emit(pair, 'Sync')
      .withArgs(token0Amount.sub(expectedOutputAmount), token1Amount.add(swapAmount))
      .to.emit(pair, 'Swap')
      .withArgs(wallet.address, false, swapAmount, expectedOutputAmount, wallet.address)

    const reserves = await pair.getReserves()
    expect(reserves[0]).to.eq(token0Amount.sub(expectedOutputAmount))
    expect(reserves[1]).to.eq(token1Amount.add(swapAmount))
    expect(await token0.balanceOf(pair.address)).to.eq(token0Amount.sub(expectedOutputAmount))
    expect(await token1.balanceOf(pair.address)).to.eq(token1Amount.add(swapAmount))
    const totalSupplyToken0 = await token0.totalSupply()
    const totalSupplyToken1 = await token1.totalSupply()
    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(token0Amount).add(expectedOutputAmount))
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(token1Amount).sub(swapAmount))
  })

  it('burn', async () => {
    const token0Amount = expandTo18Decimals(3)
    const token1Amount = expandTo18Decimals(3)
    await addLiquidity(token0Amount, token1Amount)

    const expectedLiquidity = expandTo18Decimals(3)
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    await expect(pair.burn(wallet.address, overrides))
      .to.emit(pair, 'Transfer')
      .withArgs(pair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(token0, 'Transfer')
      .withArgs(pair.address, wallet.address, token0Amount.sub(1000))
      .to.emit(token1, 'Transfer')
      .withArgs(pair.address, wallet.address, token1Amount.sub(1000))
      .to.emit(pair, 'Sync')
      .withArgs(1000, 1000)
      .to.emit(pair, 'Burn')
      .withArgs(wallet.address, token0Amount.sub(1000), token1Amount.sub(1000))

    expect(await pair.balanceOf(wallet.address)).to.eq(0)
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY)
    expect(await token0.balanceOf(pair.address)).to.eq(1000)
    expect(await token1.balanceOf(pair.address)).to.eq(1000)
    const totalSupplyToken0 = await token0.totalSupply()
    const totalSupplyToken1 = await token1.totalSupply()
    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(1000))
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(1000))
  })

  /**
   * Platform Fee off baseline case.
   */
  it('platformFeeTo:off', async () => {
    // Ensure the swap fee is set to 0.3%
    await factory.rawCall(
        pair.address,
        pair.interface.functions.setCustomSwapFee.sighash + defaultAbiCoder.encode(["uint256"], [3_000]).substring(2),
        0
    )

    // Ensure the platform fee is zero (equiv to original 'feeTo' off)
    await factory.rawCall(
        pair.address,
        pair.interface.functions.setCustomPlatformFee.sighash + defaultAbiCoder.encode(["uint256"], [0]).substring(2),
        0
    )

    const token0Amount = expandTo18Decimals(1000)
    const token1Amount = expandTo18Decimals(1000)
    await addLiquidity(token0Amount, token1Amount)

    // Confirm liquidity is established
    const expectedLiquidity = expandTo18Decimals(1000) // geometric mean of token0Amount and token1Amount
    expect(await pair.totalSupply(), "Initial total supply").to.eq(expectedLiquidity)

    const lSwapFee : number = await pair.swapFee()
    const swapAmount = expandTo18Decimals(1)

    let expectedOutputAmount: BigNumber = calcSwapWithdraw(lSwapFee, swapAmount, token0Amount, token1Amount)

    await token1.transfer(pair.address, swapAmount)
    const tx = await pair.swap(swapAmount.mul(-1), true, wallet.address, '0x', overrides)
    const receipt = await tx.wait()

    // Drain the liquidity to verify no fee has been extracted on exit
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    await pair.burn(wallet.address, overrides)
    expect(await pair.totalSupply(), "Final total supply").to.eq(MINIMUM_LIQUIDITY)
  })

  /**
   * Platform Fee on basic base.
   */
  it('platformFeeTo:on', async () => {
    const testSwapFee: number = 3_000
    const testPlatformFee: number = 166_667

    await factory.set(
        keccak256(toUtf8Bytes("Shared::platformFeeTo")),
        hexZeroPad(other.address, 32)
    )
    await factory.rawCall(
        pair.address,
        pair.interface.functions.setCustomSwapFee.sighash + defaultAbiCoder.encode(["uint256"], [testSwapFee]).substring(2),
        0
    )
    await factory.rawCall(
        pair.address,
        pair.interface.functions.setCustomPlatformFee.sighash + defaultAbiCoder.encode(["uint256"], [testPlatformFee]).substring(2),
        0
    )

    // Prepare basic liquidity of 10^18 on each token
    const token0Amount = expandTo18Decimals(1000)
    const token1Amount = expandTo18Decimals(1000)
    await addLiquidity(token0Amount, token1Amount)

    // Confirm liquidity is established
    const expectedLiquidity = expandTo18Decimals(1000) // geometric mean of token0Amount and token1Amount
    expect(await pair.totalSupply(), "Initial total supply").to.eq(expectedLiquidity)

    // Prepare for the swap - send tokens from test account (caller) into the pair
    const swapAmount = expandTo18Decimals(1)
    let expectedOutputAmount: BigNumber = calcSwapWithdraw(testSwapFee, swapAmount, token0Amount, token1Amount)
    await token1.transfer(pair.address, swapAmount)

    // Confirm the token1 balance in the pair, post transfer
    expect(await token1.balanceOf(pair.address), "New token1 balance allocated to pair").to.eq(token1Amount.add(swapAmount))

    // Perform the swap from token 1 to token 0
    const tx = await pair.swap(swapAmount.mul(-1), true, wallet.address, '0x', overrides)
    const receipt = await tx.wait()

    const newToken0Balance = await token0.balanceOf(pair.address)
    const newToken1Balance = await token1.balanceOf(pair.address)

    // Now transfer out the maximum liquidity in order to verify the remaining supply & fees etc
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    const burnTx = await pair.burn(wallet.address, overrides)
    const burnReceipt = await burnTx.wait()

    // Expected fee @ 1/6 or 0.1667% is calculated at 249750998752511 which is a ~0.0002% error off the original uniswap.
    // (Original uniswap v2 equivalent ==> 249750499251388)
    const expectedPlatformFee: BigNumber = bigNumberify(249750998752511)

    const expectedTotalSupply: BigNumber = MINIMUM_LIQUIDITY.add(expectedPlatformFee)

    // Check the new total-supply: should be MINIMUM_LIQUIDITY + platform fee
    expect(await pair.totalSupply(), "Total supply").to.eq(expectedTotalSupply)

    // Check that the fee receiver (account set to platformFeeTo) received the fees
    expect(await pair.balanceOf(other.address), "Fee receiver balance").to.eq(expectedPlatformFee)

    // The (inverted) target max variance of 0.0002% of Vexchange platform fee to VexchangeV2.
    // This variance is due to the max-precision of the platform fee and fee-pricing algorithm; inverted due to integer division math.
    const targetInverseVariance: number = 500000;

    // Verify a +/- 5% range around the variance
    const minInverseVariance: number = targetInverseVariance * 0.95;
    const maxInverseVariance: number = targetInverseVariance * 1.05;

    // Compare 1/6 UniV2 fee, using 0.166667 Vexchange Platform fee: run check to confirm ~ 0.0002% variance.
    const token0ExpBalUniV2: BigNumber = bigNumberify( '249501683697445' )
    const token0ExpBalVexchange: BigNumber = bigNumberify( '249502182700812' )
    const token0Variance: number = token0ExpBalUniV2.div(token0ExpBalVexchange.sub(token0ExpBalUniV2)).toNumber();
    expect(token0Variance, "token 0 variance from uniswap v2 fee" ).to.be.within(minInverseVariance, maxInverseVariance)

    // Compare 1/6 UniV2 fee, using 0.166667 Vexchange Platform fee: run check to confirm ~ 0.0002% variance.
    const token1ExpBalUniV2: BigNumber = bigNumberify( '250000187312969' )
    const token1ExpBalVexchange: BigNumber = bigNumberify( '250000687313344' )
    const token1Variance: number = token1ExpBalUniV2.div(token1ExpBalVexchange.sub(token1ExpBalUniV2)).toNumber();
    expect(token1Variance, "token 1 variance from uniswap v2 fee" ).to.be.within(minInverseVariance, maxInverseVariance)

    // using 1000 here instead of the symbolic MINIMUM_LIQUIDITY because the amounts only happen to be equal...
    // ...because the initial liquidity amounts were equal
    expect(await token0.balanceOf(pair.address), "Token 0 balance of pair").to.eq(bigNumberify(1000).add(token0ExpBalVexchange))
    expect(await token1.balanceOf(pair.address), "Token 1 balance of pair").to.eq(bigNumberify(1000).add(token1ExpBalVexchange))
  })

  /**
   * calcPlatformFee
   *
   * Note that this function is deliberately verbose, implementing the Pair contract's platform-fee calculation, with
   * additional assertion validation.
   *
   * This function is used in further tests below, to verify correct operation of the fee calculations in  the contract transactions.
   *
   * Test Strategy
   * =============
   *  - Rely on the mathematically proven fact that the implemented platformFee is mathematically equivalent to the Uniswap general
   *    equation for fees (for this equation, see whitepaper, equation 6);
   *  - Implement the platformFee calculation in javascript, in order to use it to verify the contract transaction values;
   *  - Prove the javascript implementation by pre-calculated and manually confirmed values;
   *  - Use the javascript implementation to verify swap and burn transactions, verifying correct fees.
   *
   * Details
   * =======
   * The javascript implementation of the contract's platform fee calculation is found in this function is a direct copy of the
   * contract implementation with additional assertions around assumptions made for the contract, but that are not included in
   * the contract to minimise gas cost.
   *
   * Note that the function calcPlatformFeeUniswap() is a direct implementation of the Uniswap whitepaper equation 6, and implemented
   * with floating point not integer arithmetic for additional cross-validation. compareCalcPlatformFee proves that the results of
   * this equation are equivalent, assuming integer ( floor() ) rounding.
   *
   * The tests calcPlatformFeeTestCases confirm that the calcPlatformFee function produce expected results over a range of values -
   * with pre calculated expected values.
   *
   * The tests in platformFeeRange then iterate over a transaction involving a specific swap then burn, verifying final total supply and
   * balances are as expected, based on expected fees per the calcPlatformFee() function.
   */
  function calcPlatformFee(
    aPlatformFee: BigNumber,
    aToken0Balance: BigNumber,
    aToken1Balance: BigNumber,
    aNewToken0Balance: BigNumber,
    aNewToken1Balance: BigNumber) : BigNumber
  {
    // Constants from VexchangeV2Pair _calcFee
    const ACCURACY_SQRD : BigNumber = bigNumberify('10000000000000000000000000000000000000000000000000000000000000000000000000000')
    const ACCURACY      : BigNumber = bigNumberify('100000000000000000000000000000000000000')
    const FEE_ACCURACY  : BigNumber = bigNumberify(1_000_000)

    const lTotalSupply  : BigNumber = bigNumberSqrt(aToken0Balance.mul(aToken1Balance))

    // The pair invariants for the pool (sqrt'd)
    const pairSqrtInvariantOriginal: BigNumber = bigNumberSqrt( aToken0Balance.mul(aToken1Balance) )
    const pairSqrtInvariantNew: BigNumber = bigNumberSqrt( aNewToken0Balance.mul(aNewToken1Balance) )

    // Assertions made but not enforced by Pair contract
    expect(pairSqrtInvariantOriginal, 'pairSqrtINvariantOriginal < 104bit').to.lte(MAX_UINT_104)
    expect(pairSqrtInvariantNew, 'pairSqrtInvariantNew < 104bit').to.lte(MAX_UINT_104)
    expect(aPlatformFee, 'platformFee < FeeAccuracy').to.lte(FEE_ACCURACY)
    expect(lTotalSupply, 'totalSupply < 104bit').to.lte(MAX_UINT_104)

    // The algorithm from VexchangeV2Pair _calcFee
    const lScaledGrowth = pairSqrtInvariantNew.mul(ACCURACY).div(pairSqrtInvariantOriginal)
    expect( lScaledGrowth, 'scaled-growth < 256bit').to.lte( MAX_UINT_256 )

    const lScaledMultiplier = ACCURACY.sub(ACCURACY_SQRD.div(lScaledGrowth))
    expect( lScaledMultiplier, 'scaled-multiplier < 128bit').to.lte(MAX_UINT_128)

    const lScaledTargetOwnership = lScaledMultiplier.mul(aPlatformFee).div(FEE_ACCURACY)
    expect(lScaledTargetOwnership, 'scaled-target-ownership < 128bit').to.lte(MAX_UINT_128)

    const resultantFee = lScaledTargetOwnership.mul(lTotalSupply).div(ACCURACY.sub(lScaledTargetOwnership));

    return resultantFee
  } // calcPlatformFee

  /**
   * calcPlatformFeeUniswap
   *
   * This method implements the Uniswap whitepaper equation 5 explicitly, and using floating point
   * (Javascript numbers) for cross-validation.
   */
  function calcPlatformFeeUniswap(aPlatformFee: BigNumber,
                                  aToken0Balance: BigNumber, aToken1Balance: BigNumber,
                                  aNewToken0Balance: BigNumber, aNewToken1Balance: BigNumber) : number
  {
    // Calculate the total-supply as the geometric mean of the initial token balances.
    const lTotalSupply  : number = Math.sqrt(aToken0Balance.toNumber() * aToken1Balance.toNumber())

    // Calculate the sqrt of invariants for the pool
    const K1: number = Math.sqrt(aToken0Balance.toNumber() * aToken1Balance.toNumber())
    const K2: number = Math.sqrt(aNewToken0Balance.toNumber() * aNewToken1Balance.toNumber())

    // Calculate 1/fee, exit is fee is zero
    if (aPlatformFee.eq(bigNumberify(0))) return 0;
    const inverseFee : number = 1_000_000 / aPlatformFee.toNumber();

    // Implement whitepaper equation
    const numerator : number = lTotalSupply * (K2 - K1);
    const denominator : number = (inverseFee - 1) * K2 + K1;
    const sharesToMint: number = (denominator == 0) ? 0 : (numerator / denominator);
    return sharesToMint
  } // calcPlatformFeeUniswapAsNumber

  /**
   * calcSwapWithdraw
   * Returns the maximum withdrawl amount, based on the input amount and the
   * pair's (variable) fee.
   *
   * Note that this function is deliberately verbose.
   *
   * @param {number} aSwapFee The current swap-fee for the pair.
   * @param {BigNumber} aSwapAmount The amount being swapped.
   * @param {BigNumber} aToken0Balance The current balance of token-0 in the pair.
   * @param {BigNumber} aToken1Balance The current balance of token-1 in the pair.
   * @return {number} The max swapped amount to withdraw..
   */
  function calcSwapWithdraw(aSwapFee: number, aSwapAmount: BigNumber,
                            aWithdrawTokenBalance: BigNumber, aDepositTokenBalance: BigNumber) : BigNumber
  {
    // The pair invariant for the pool
    const pairInvariant: BigNumber = aWithdrawTokenBalance.mul(aDepositTokenBalance)

    // The amount added to the liquidity pool after fees
    const depositAfterFees : BigNumber = aSwapAmount.mul(1_000_000-aSwapFee).div(1_000_000)

    // The new token1 total (add the incoming liquidity)
    const depositTokenAfterDeposit: BigNumber = aDepositTokenBalance.add(depositAfterFees)

    // Using the invariant, calculate the impact on token 0 from the new liquidity
    let maxWithdrawTokenAvail: BigNumber = pairInvariant.div(depositTokenAfterDeposit)

    // Check for rounding error (BigNumber division will floor instead of rounding);
    // If product of token0Impact & token1AfterDeposity is less than invariant, increment the token0Impact.
    if ( pairInvariant.gt(maxWithdrawTokenAvail.mul(depositTokenAfterDeposit)))
      maxWithdrawTokenAvail = maxWithdrawTokenAvail.add(1)

    // Calculate the new aWithdrawTokenBalance delta, which is the maximum amount that could be
    // removed and still maintain the invariant
    const maxTokenToWithdraw: BigNumber =  aWithdrawTokenBalance.sub(maxWithdrawTokenAvail)

    return maxTokenToWithdraw
  } // calcSwapWithdraw

  /**
   * ComparisonRecord for reporting comparison results via console.table()
   */
  class ComparisonRecord {
    Fee : String = "-";
    Initial0 : String = "-";
    Initial1 : String = "-";
    Final0 : String = "-";
    Final1 : String = "-";
    TotalSupply: String = "-";
    VexchangeFee : String = "-";
    UniswapFee: String = "-";
    Delta : String = "-";
    DeltaPct : String = "-";
  }
  var lComparisonReportData : ComparisonRecord[] = [];

  const comparisonTestCases: BigNumber[][] = [
    [      0,  10000,  10000,    20000,    20000 ], //< Zero plaform-fee.
    [    500,  10000,  10000,    10000,    10000 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [    500,  10000,   5000,    10000,     5000 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [    500,  10000,   5000,     5000,    10000 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [    500,   5000,  10000,    10000,     5000 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [    500,  10000,  10000,    20000,    20000 ],
    [   1000,  10000,  10000,    20000,    20000 ],
    [   2500,  10000,  10000,    50000,    50000 ],
    [   5000,  10000,  10000,    20000,    20000 ],
    [  10000,  10000,  10000,    20000,    20000 ],
    [  50000,  10000,  10000,    20000,    20000 ],
    [ 100000,  10000,  10000,    20000,    20000 ],
    [ 100000, 100000, 100000,   160000,   160000 ],
    [ 100000, 100000, 100000,   500000,   500000 ],
    [ 166667,  10000,  10000,    20000,    20000 ],
    [ 166667,  10000,  10000,    90000,    90000 ],
    [ 166667,  10000,  10000,   200000,   200000 ],
    [ 166667,  10000,  10000,  9900000,  9900000 ],
    [ 200000,  10000,  10000,    20000,    20000 ],
    [ 250000,  10000,  10000,    20000,    20000 ],
    [ 250000,  10000,  10000,    15000,    10000 ],
    [ 250000,  10000,  10000,    10000,    15000 ],
    [ 250000,   5000,  20000,    10000,    15000 ],
    [ 250000,  20000,   5000,    10000,    15000 ],
    [ 250000,   5000,  10000,    10000,     5000 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [ 250000,  10000,   5000,     5000,    10000 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [ 250000,  10000,   5000,    20000,    10000 ],
    [ 250000,  10000,  10000,    50000,    50000 ],
    [ 250000,  20000,  20000,    60000,    60000 ],
    [ 250000, 100000, 100000,   500000,   500000 ],
    [ 300000,  10000,  10000,    12000,    12000 ],
    [ 300000,  10000,  10000,    10500,    10500 ],
    [ 450000,  10000,  10000,    10200,    10200 ],
    [ 500000,  10000,  10000,    50000,    50000 ],
    [ 500000, 100000, 100000,   500000,   500000 ],
    [ 500000, 100000, 100000,  1000000,  1000000 ],
    [ 500000, 100000, 100000,  2000000,  2000000 ],
    [ 495000,   1000,   1000, 99000000, 99000000 ],
    [ 495000,   1000,   1000, 99000000, 99000000 ],
  ].map(a => a.map(n => (bigNumberify(n))))
  comparisonTestCases.forEach((platformFeeTestCase, i) => {
    it(`compareCalcPlatformFee:${i}`, async () => {
      const [platformFee, token0InitialBalance, token1InitialBalance, token0FinalBalance, token1FinalBalance] = platformFeeTestCase
      const totalSupply  : BigNumber = bigNumberSqrt(token0InitialBalance.mul(token1InitialBalance))

      // Calculate via the two alternate fee calculations
      const lVexchangeFeeResult: BigNumber = calcPlatformFee( platformFee, token0InitialBalance, token1InitialBalance, token0FinalBalance, token1FinalBalance )
      const lUniswapFeeResult: number = calcPlatformFeeUniswap( platformFee, token0InitialBalance, token1InitialBalance, token0FinalBalance, token1FinalBalance )

      // Calculate variance
      const lDelta : number = lUniswapFeeResult - lVexchangeFeeResult.toNumber();
      const lDeltaPct : number = (lUniswapFeeResult == 0) ? 0 : (lDelta * 100 / lUniswapFeeResult);

      // Validate that the Vexchange result is within 1 integer value in all cases.
      expect( lDelta, 'Vexchange equation validation' ).to.satisfy(
          function(valueToTest : number) { return (valueToTest >= -1) && (valueToTest <= 1) }
      );

      // Report for visual comarison
      const lComparisonRecord: ComparisonRecord = {
        Fee: platformFee.toString(),
        Initial0: token0InitialBalance.toString(),
        Initial1: token1InitialBalance.toString(),
        Final0: token0FinalBalance.toString(),
        Final1: token1FinalBalance.toString(),
        TotalSupply: totalSupply.toString(),
        VexchangeFee: lVexchangeFeeResult.toString(),
        UniswapFee: lUniswapFeeResult.toFixed(2),

        Delta: lDelta.toFixed(3),
        DeltaPct: `${lDeltaPct.toFixed(3)} %`
      }

      lComparisonReportData.push(lComparisonRecord);
    })
  }) // compareCalcPlatformFee

  // Log the data to console - generated by calcPlatformFeeTestCases;
  // Uncomment to log comparison data to console.
  // it('compareCalcPlatformFeeReport', async () => {
  //   console.table( lComparisonReportData );
  // })

  /**
   * Verify the calcPlatformFee in terms of straight-forward use-cases;
   * based on platformFee, initial balances & final balances.
   *
   * (Last-k and new-k invariants are derived from the intial & final balances)
   *
   * Test values:
   *   platformFee, token0Initial, token1Initial, token0Final, token1Final, resultantFee
   *
   * Expected resultantFee below has been verified with eq (6) of uniswap v2 whitepaper.
   * https://uniswap.org/whitepaper.pdf
   */
  const calcPlatformFeeTestCases: BigNumber[][] = [
    [      0,  10000,  10000,   20000,   20000,     0 ], //< Zero plaform-fee.
    [    500,  10000,  10000,   10000,   10000,     0 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [    500,  10000,   5000,   10000,    5000,     0 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [    500,  10000,   5000,    5000,   10000,     0 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [    500,   5000,  10000,   10000,    5000,     0 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [    500,  10000,  10000,   20000,   20000,     2 ],
    [   1000,  10000,  10000,   20000,   20000,     5 ],
    [   2500,  10000,  10000,   50000,   50000,    20 ],
    [   5000,  10000,  10000,   20000,   20000,    25 ],
    [  10000,  10000,  10000,   20000,   20000,    50 ],
    [  50000,  10000,  10000,   20000,   20000,   256 ],
    [ 100000,  10000,  10000,   20000,   20000,   526 ],
    [ 100000, 100000, 100000,  160000,  160000,  3896 ],
    [ 100000, 100000, 100000,  500000,  500000,  8695 ],
    [ 166700,  10000,  10000,   20000,   20000,   909 ],
    [ 200000,  10000,  10000,   20000,   20000,  1111 ],
    [ 250000,  10000,  10000,   20000,   20000,  1428 ],
    [ 250000,  10000,  10000,   15000,   10000,   480 ],
    [ 250000,  10000,  10000,   10000,   15000,   480 ],
    [ 250000,   5000,  20000,   10000,   15000,   480 ],
    [ 250000,  20000,   5000,   10000,   15000,   480 ],
    [ 250000,   5000,  10000,   10000,    5000,     0 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [ 250000,  10000,   5000,    5000,   10000,     0 ], //< Equivalent liquidity, so growth & zero fee: not technically possible from _mintFee.
    [ 250000,  10000,   5000,   20000,   10000,  1010 ],
    [ 250000,  10000,  10000,   50000,   50000,  2500 ],
    [ 250000,  20000,  20000,   60000,   60000,  3999 ],
    [ 250000, 100000, 100000,  500000,  500000, 25000 ],
    [ 300000,  10000,  10000,   12000,   12000,   526 ],
    [ 500000,  10000,  10000,   50000,   50000,  6666 ],
    [ 500000, 100000, 100000,  500000,  500000, 66666 ],
    [ 500000, 100000, 100000, 1000000, 1000000, 81818 ],
    [ 500000, 100000, 100000, 2000000, 2000000, 90476 ],
  ].map(a => a.map(n => (bigNumberify(n))))
  calcPlatformFeeTestCases.forEach((platformFeeTestCase, i) => {
    it(`calcPlatformFee:${i}`, async () => {
      const [platformFee, token0InitialBalance, token1InitialBalance, token0FinalBalance, token1FinalBalance, expectedPlatformFee] = platformFeeTestCase
      expect(calcPlatformFee(platformFee, token0InitialBalance, token1InitialBalance, token0FinalBalance, token1FinalBalance)).to.eq(expectedPlatformFee)
    })
  })

  /**
   * Test the platform fee calculation with a test-case curve of swapFee and plaformFee variance.
   *
   * Verify correctness of Swap Fee & Platform Fee at balance boundaries.
   *
   * - Add liquidity of MAX_UINT_256 - MAX_UINT_64 to both sides of the pair;
   * - Swap MAX_UINT_64 from token0 to token1, taking token1 to its maximum.
   * - Remove all funds, and verify the remainder is as expected (minimum liquidity)
   *
   * Test Values: swapFee, platformFee (in basis points)
   */
  const swapAndPlatformFeeTestCases: BigNumber[][] = [
    [1, 500],
    [1, 1667],
    [1, 2500],
    [1, 5000],
    [5, 500],
    [5, 1667],
    [5, 2500],
    [5, 5000],
    [15, 500],
    [15, 1667],
    [15, 2500],
    [15, 5000],
    [30, 500],
    [30, 1667],
    [30, 3000],
    [30, 5000],
    [50, 500],
    [50, 1667],
    [50, 2500],
    [50, 5000],
    [100, 500],
    [100, 1667],
    [100, 2500],
    [100, 5000],
    [150, 500],
    [150, 1667],
    [150, 2500],
    [150, 5000],
    [200, 500],
    [200, 1667],
    [200, 2500],
    [200, 5000]
  ].map(a => a.map(n => (bigNumberify(n))))
  swapAndPlatformFeeTestCases.forEach((swapAndPlatformTestCase, i) => {
    it(`platformFeeRange:${i}`, async () => {
      const [swapFee, platformFee] = swapAndPlatformTestCase

      // Setup the platform and swap fee
      await factory.rawCall(
          pair.address,
          pair.interface.functions.setCustomSwapFee.sighash + defaultAbiCoder.encode(["uint256"], [swapFee]).substring(2),
          0
      )
      await factory.rawCall(
          pair.address,
          pair.interface.functions.setCustomPlatformFee.sighash + defaultAbiCoder.encode(["uint256"], [platformFee]).substring(2),
          0
      )
      await factory.set(
          keccak256(toUtf8Bytes("Shared::platformFeeTo")),
          hexZeroPad(other.address, 32)
      )

      const swapAmount : BigNumber = bigNumberify(expandTo18Decimals(1));

      // Setup liquidity in the pair - leave room for a swap to MAX one side
      const token0Liquidity = MAX_UINT_104.sub(swapAmount)
      const token1Liquidity = MAX_UINT_104.sub(swapAmount)
      await addLiquidity(token0Liquidity, token1Liquidity)

      const expectedLiquidity = MAX_UINT_104.sub(swapAmount)
      expect(await pair.totalSupply(), "Initial total supply").to.eq(expectedLiquidity)

      let expectedSwapAmount: BigNumber = calcSwapWithdraw(swapFee.toNumber(), swapAmount, token0Liquidity, token1Liquidity)

      await token1.transfer(pair.address, swapAmount)
      const swapTx = await pair.swap(swapAmount.mul(-1), true, wallet.address, '0x', overrides)
      const swapReceipt = await swapTx.wait()

      // Calculate the expected platform fee
      const token0PairBalanceAfterSwap = await token0.balanceOf(pair.address);
      const token1PairBalanceAfterSwap = await token1.balanceOf(pair.address);
      const expectedPlatformFee : BigNumber = calcPlatformFee( platformFee, token0Liquidity, token1Liquidity, token0PairBalanceAfterSwap, token1PairBalanceAfterSwap )

      // Drain the liquidity to verify no fee has been extracted on exit
      await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      const burnTx = await pair.burn(wallet.address, overrides)
      const burnReceipt = await burnTx.wait()

      // Determine the expected total supply post swap, and swapFee / platformFee removal
      const expectedTotalSupply: BigNumber = MINIMUM_LIQUIDITY.add(expectedPlatformFee)

      // Check the new total-supply: should be MINIMUM_LIQUIDITY + platform fee
      expect(await pair.totalSupply(), "Final total supply").to.satisfy(
          function(a:BigNumber) { return closeTo(a, expectedTotalSupply) } )

      // Check that the fee receiver (account set to platformFeeTo) received the fees
      expect(await pair.balanceOf(other.address), "Fee receiver balance").to.eq(expectedPlatformFee)

      // using 1000 here instead of the symbolic MINIMUM_LIQUIDITY because the amounts only happen to be equal...
      // ...because the initial liquidity amounts were equal

      const token0ExpBalVexchange: BigNumber = bigNumberify( expectedPlatformFee )
      expect(await token0.balanceOf(pair.address), "Token 0 balance of pair").to.satisfy(
          function(a:BigNumber) { return closeTo(a, bigNumberify(1000).add(token0ExpBalVexchange)) })

      const token1ExpBalVexchange: BigNumber = bigNumberify( expectedPlatformFee )
      expect(await token1.balanceOf(pair.address), "Token 1 balance of pair").to.satisfy(
          function(a:BigNumber) { return closeTo(a, bigNumberify(1000).add(token1ExpBalVexchange)) })
    })
  })

  /**
   * basicOverflow
   *
   * Testing mint and swap handling of an overflow balance (> max-uint-104).
   */
  it('basicOverflow', async () => {
    const platformFee : BigNumber = bigNumberify(2500)

    // Ensure the platform fee is set
    await factory.rawCall(
        pair.address,
        pair.interface.functions.setCustomPlatformFee.sighash + defaultAbiCoder.encode(["uint256"], [platformFee]).substring(2),
        0
    )
    await factory.set(
        keccak256(toUtf8Bytes("Shared::platformFeeTo")),
        hexZeroPad(other.address, 32)
    )

    // Setup minimum liquidity
    const initial0Amount = MINIMUM_LIQUIDITY.add(1)
    const initial1Amount = MINIMUM_LIQUIDITY.add(1)
    await addLiquidity(initial0Amount, initial1Amount)

    const expectedInitialLiquidity = MINIMUM_LIQUIDITY.add(1)
    expect(await pair.totalSupply(), "Initial total supply").to.eq(expectedInitialLiquidity)

    // Add a lot more - taking us to the limit
    const token0Amount = MAX_UINT_104.sub(initial0Amount)
    const token1Amount = MAX_UINT_104.sub(initial1Amount)
    await addLiquidity(token0Amount, token1Amount)

    // Confirm liquidity is established
    const expectedLiquidity = MAX_UINT_104 // geometric mean of token0Amount and token1Amount (equal, so can use one)
    expect(await pair.totalSupply(), "Second stage total supply").to.eq(expectedLiquidity)

    // Confirm we cannot add even just another little wafer ... expect an overflow revert.
    await token0.transfer(pair.address, bigNumberify(1))
    await token1.transfer(pair.address, bigNumberify(1))
    await expect( pair.mint(wallet.address, overrides), 'mint with too much balance' ).to.be.revertedWith('CP: OVERFLOW')

    // Reconfirm established liquidity
    expect(await pair.totalSupply(), "Total supply post failed mint").to.eq(expectedLiquidity)

    // Also try and swap the wafer
    await expect(pair.swap(bigNumberify(1), true, wallet.address, '0x', overrides), 'swap with too much balance').to.be.revertedWith('CP: OVERFLOW')
  })

  /**
   *  recoverToken - error handling for invalid tokens
   */
  it('recoverToken:invalidToken', async () => {
    await expect(pair.recoverToken(token0.address)).to.be.revertedWith('P: INVALID_TOKEN_TO_RECOVER')
    await expect(pair.recoverToken(token1.address)).to.be.revertedWith('P: INVALID_TOKEN_TO_RECOVER')

    const invalidTokenAddress = "0x3704E657053C02411aA2Fd0599e75C3d817F81BC"
    await expect(pair.recoverToken(invalidTokenAddress)).to.be.reverted
  })

  /**
   *  recoverToken - failure when recoverer is AddressZero or not set
   */
  it('recoverToken:AddressZero', async () => {
    await factory.set(
        keccak256(toUtf8Bytes("Shared::defaultRecoverer")),
        hexZeroPad(AddressZero, 32)
    )
    await expect(pair.recoverToken(token2.address)).to.be.revertedWith('P: RECOVERER_ZERO_ADDRESS')

    // Transfer some token2 to pair address
    const token2Amount = expandTo18Decimals(3)
    await token2.transfer(pair.address, token2Amount)
    expect(await token2.balanceOf(pair.address)).to.eq(token2Amount)

    // recoverToken should still fail
    await expect(pair.recoverToken(token2.address)).to.be.revertedWith('P: RECOVERER_ZERO_ADDRESS')
  })

  /**
   *  recoverToken - when there are no tokens to be recovered
   */
  it('recoverToken:noAmount', async () => {
    // There should not be any token of the kind to be recovered
    // in the recoverer's account
    expect(await token2.balanceOf(recoverer)).to.eq(0)
    await pair.recoverToken(token2.address)
    expect(await token2.balanceOf(recoverer)).to.eq(0)
  })

  /**
   *  recoverToken - normal use case
   */
  it('recoverToken:base' , async () => {
    const token2Amount = expandTo18Decimals(3)
    await token2.transfer(pair.address, token2Amount)
    expect(await token2.balanceOf(pair.address)).to.eq(token2Amount)

    await pair.recoverToken(token2.address)

    // All token2 should be drained from the pair
    // and be transferred to the recoverer
    expect(await token2.balanceOf(pair.address)).to.eq(0)
    expect(await token2.balanceOf(recoverer)).to.eq(token2Amount)
  })
})
