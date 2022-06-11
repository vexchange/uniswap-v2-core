import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import {BigNumber, bigNumberify} from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { getCreate2Address } from './shared/utilities'
import { factoryFixture } from './shared/fixtures'

import UniswapV2Pair from '../out/UniswapV2Pair.sol/UniswapV2Pair.json'
import { AddressZero } from "ethers/constants";

chai.use(solidity)

const TEST_ADDRESSES: [string, string] = [
  '0x1000000000000000000000000000000000000000',
  '0x2000000000000000000000000000000000000000'
]

describe('UniswapV2Factory', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet, other] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet, other])

  let factory: Contract
  let expectedDefaultSwapFee: BigNumber
  let expectedDefaultPlatformFee: BigNumber
  let expectedPlatformFeeTo: string

  beforeEach(async () => {
    const fixture = await loadFixture(factoryFixture)
    factory = fixture.factory
    expectedDefaultSwapFee = fixture.defaultSwapFee
    expectedDefaultPlatformFee = fixture.defaultPlatformFee
    expectedPlatformFeeTo = fixture.platformFeeTo
  })

  it('platformFeeTo, defaultSwapFee, defaultPlatformFee, platformFeeTo, defaultRecoverer, allPairsLength', async () => {
    expect(await factory.defaultSwapFee()).to.eq(expectedDefaultSwapFee)
    expect(await factory.defaultPlatformFee()).to.eq(expectedDefaultPlatformFee)
    expect(await factory.platformFeeTo()).to.eq(expectedPlatformFeeTo)
    expect(await factory.defaultRecoverer()).to.eq(AddressZero)
    expect(await factory.allPairsLength()).to.eq(0)
  })

  async function createPair(tokens: [string, string]) {
    const bytecode = UniswapV2Pair.bytecode.object
    const create2Address = getCreate2Address(factory.address, tokens, bytecode)
    await expect(factory.createPair(...tokens, ))
      .to.emit(factory, 'PairCreated')
      .withArgs(
          TEST_ADDRESSES[0],
          TEST_ADDRESSES[1],
          create2Address,
          bigNumberify(1),
          expectedDefaultSwapFee,
          expectedDefaultPlatformFee
      )

    await expect(factory.createPair(...tokens)).to.be.reverted // UniswapV2: PAIR_EXISTS
    await expect(factory.createPair(...tokens.slice().reverse())).to.be.reverted // UniswapV2: PAIR_EXISTS
    expect(await factory.getPair(...tokens)).to.eq(create2Address)
    expect(await factory.getPair(...tokens.slice().reverse())).to.eq(create2Address)
    expect(await factory.allPairs(0)).to.eq(create2Address)
    expect(await factory.allPairsLength()).to.eq(1)

    const pair = new Contract(create2Address, JSON.stringify(UniswapV2Pair.abi), provider)
    expect(await pair.factory()).to.eq(factory.address)
    expect(await pair.token0()).to.eq(TEST_ADDRESSES[0])
    expect(await pair.token1()).to.eq(TEST_ADDRESSES[1])
  }

  it('createPair', async () => {
    await createPair(TEST_ADDRESSES)
  })

  it('createPair:reverse', async () => {
    await createPair(TEST_ADDRESSES.slice().reverse() as [string, string])
  })

  it('setPlatformFeeTo', async () => {
    await expect(factory.connect(other).setPlatformFeeTo(other.address)).to.be.revertedWith('Ownable: caller is not the owner')
    await factory.setPlatformFeeTo(wallet.address)
    expect(await factory.platformFeeTo()).to.eq(wallet.address)
  })
})
