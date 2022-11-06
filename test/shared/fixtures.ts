import { Contract, Wallet } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { deployContract } from 'ethereum-waffle'
import { SimpleContractJSON } from "ethereum-waffle/dist/esm/ContractJSON"

import { MAX_UINT_128 } from './utilities'
import TestERC20 from '../../out/TestERC20.sol/TestERC20.json'
import GenericFactory from '../../out/GenericFactory.sol/GenericFactory.json'
import ConstantProductPair from '../../out/ConstantProductPair.sol/ConstantProductPair.json'
import {
  BigNumber,
  bigNumberify,
  keccak256,
  toUtf8Bytes,
  hexZeroPad,
  hexlify,
} from "ethers/utils";

interface FactoryFixture {
  factory: Contract
  defaultSwapFee: BigNumber
  defaultPlatformFee: BigNumber
  defaultAllowedChangePerSecond: BigNumber
  platformFeeTo: string
  recoverer: string
}

const overrides = {
  gasLimit: 9999999
}

export async function factoryFixture(_: Web3Provider, [wallet]: Wallet[]): Promise<FactoryFixture> {
  const defaultSwapFee: BigNumber = bigNumberify(3_000);
  const defaultPlatformFee: BigNumber = bigNumberify(0);
  const defaultAllowedChangePerSecond = bigNumberify(0.0005e18);
  const platformFeeTo: string = "0x3000000000000000000000000000000000000000"
  const recoverer: string = "0x5000000000000000000000000000000000000000"
  const GenericFactoryRebuilt: SimpleContractJSON = {
    abi: GenericFactory.abi,
    bytecode: GenericFactory.bytecode.object
  }

  const factory = await deployContract(wallet, GenericFactoryRebuilt, [], overrides)
  await factory.addCurve(ConstantProductPair.bytecode.object);

  await factory.set(keccak256(toUtf8Bytes("CP::swapFee")),  hexZeroPad(hexlify(defaultSwapFee), 32));
  await factory.set(keccak256(toUtf8Bytes("Shared::platformFee")), hexZeroPad(hexlify(defaultPlatformFee), 32));
  await factory.set(keccak256(toUtf8Bytes("Shared::defaultRecoverer")), hexZeroPad(recoverer, 32));
  await factory.set(keccak256(toUtf8Bytes("Shared::allowedChangePerSecond")), hexZeroPad(hexlify(defaultAllowedChangePerSecond), 32));

  return { factory, defaultSwapFee, defaultPlatformFee, defaultAllowedChangePerSecond, platformFeeTo, recoverer }
}

interface PairFixture extends FactoryFixture {
  token0: Contract
  token1: Contract
  token2: Contract
  pair: Contract
}

export async function pairFixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<PairFixture> {
  const { factory, defaultSwapFee, defaultPlatformFee, defaultAllowedChangePerSecond, platformFeeTo, recoverer } = await factoryFixture(provider, [wallet])

  const ERC20Rebuilt: SimpleContractJSON = {
    abi: TestERC20.abi,
    bytecode: TestERC20.bytecode.object
  }

  // Setup initial liquidity of pair's tokens; 10000 x 10^8  originally used in tests, this
  // is expanded for overflow testing of new platformFee tests to max-uint 128bit.
  const tokenSupply: BigNumber = MAX_UINT_128;

  const tokenA = await deployContract(wallet, ERC20Rebuilt, [tokenSupply], overrides)
  const tokenB = await deployContract(wallet, ERC20Rebuilt, [tokenSupply], overrides)
  const tokenC = await deployContract(wallet, ERC20Rebuilt, [tokenSupply], overrides)

  await factory.createPair(tokenA.address, tokenB.address, 0, overrides)
  const pairAddress = await factory.getPair(tokenA.address, tokenB.address, 0)
  const pair = new Contract(pairAddress, JSON.stringify(ConstantProductPair.abi), provider).connect(wallet)

  const token0Address = await pair.token0()
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA
  const token2 = tokenC

  return { factory, defaultSwapFee, defaultPlatformFee, defaultAllowedChangePerSecond, platformFeeTo, recoverer, token0, token1, token2, pair }
}
