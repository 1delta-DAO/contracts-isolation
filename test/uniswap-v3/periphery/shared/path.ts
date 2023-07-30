import { utils } from 'ethers'
import { AbiCoder } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import { FeeAmount } from './constants'

const ADDR_SIZE = 20
const FEE_SIZE = 3
const FLAG_SIZE = 1
const OFFSET = ADDR_SIZE + FEE_SIZE
const DATA_SIZE = OFFSET + ADDR_SIZE

export function encodePath(path: string[], fees: FeeAmount[]): string {
  if (path.length != fees.length + 1) {
    throw new Error('path/fee lengths do not match')
  }

  let encoded = '0x'
  for (let i = 0; i < fees.length; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2)
    // 3 byte encoding of the fee
    encoded += fees[i].toString(16).padStart(2 * FEE_SIZE, '0')
  }
  // encode the final token
  encoded += path[path.length - 1].slice(2)

  return encoded.toLowerCase()
}

export function encodeAlgebraPath(path: string[], fees: FeeAmount[], flags: number[], flag: number): string {
  if (path.length != fees.length + 1) {
    throw new Error('path/fee lengths do not match')
  }

  let encoded = '0x'
  for (let i = 0; i < fees.length; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2)
    // 3 byte encoding of the fee
    encoded += fees[i].toString(16).padStart(2 * FEE_SIZE, '0')
    // 1 byte encoding of the flags
    encoded += flags[i].toString(16).padStart(2 * FLAG_SIZE, '0')
  }
  // encode the final token
  encoded += path[path.length - 1].slice(2)
  encoded += flag.toString(16).padStart(2 * FLAG_SIZE, '0')

  return encoded.toLowerCase()
}

const typeSlice = ['address', 'uint24', 'uint8',]

export function encodeAlgebraPathEthers(path: string[], fees: FeeAmount[], flags: number[], flag: number): string {
  if (path.length != fees.length + 1) {
    throw new Error('path/fee lengths do not match')
  }
  let types: string[] = []
  let data: string[] = []
  for (let i = 0; i < fees.length; i++) {
    const p = path[i]
    types = [...types, ...typeSlice]
    data = [...data, p, String(fees[i]), String(flags[i])]
  }
  // add last address and flag
  types.push('address')
  types.push('uint8')
  data.push(path[path.length - 1])
  data.push(String(flag))

  // console.log(data)
  // console.log(types)

  return ethers.utils.solidityPack(types, data)
}

// token address, poolFee, poolId, tradeType
const typeSliceAggragator = ['address', 'uint24', 'uint8','uint8',]

export function encodeAggregtorPathEthers(path: string[], fees: FeeAmount[], flags: number[],pIds:number[], flag: number): string {
  if (path.length != fees.length + 1) {
    throw new Error('path/fee lengths do not match')
  }
  let types: string[] = []
  let data: string[] = []
  for (let i = 0; i < fees.length; i++) {
    const p = path[i]
    types = [...types, ...typeSliceAggragator]
    data = [...data, p, String(fees[i]), String(pIds[i]), String(flags[i])]
  }
  // add last address and flag
  types.push('address')
  types.push('uint8')
  
  data.push(path[path.length - 1])
  data.push(String(flag))

  // console.log(data)
  // console.log(types)

  return ethers.utils.solidityPack(types, data)
}


const typeSliceSimple = ['address', 'uint8',]

export function encodeAlgebraPathEthersSimple(path: string[], flags: number[], flag: number): string {
  if (path.length != flags.length + 1) {
    throw new Error('path/fee lengths do not match')
  }
  let types: string[] = []
  let data: string[] = []
  for (let i = 0; i < flags.length; i++) {
    const p = path[i]
    types = [...types, ...typeSliceSimple]
    data = [...data, p, String(flags[i])]
  }
  // add last address and flag
  types.push('address')
  types.push('uint8')
  data.push(path[path.length - 1])
  data.push(String(flag))

  // console.log(data)
  // console.log(types)

  return ethers.utils.solidityPack(types, data)
}





export function encodeAddress(path: string): string {

  return ethers.utils.solidityPack(['address'], [path])

  // return AbiCoder.prototype.encode(['address'], [path])

}

function decodeOne(tokenFeeToken: Buffer): [[string, string], number] {
  // reads the first 20 bytes for the token address
  const tokenABuf = tokenFeeToken.slice(0, ADDR_SIZE)
  const tokenA = utils.getAddress('0x' + tokenABuf.toString('hex'))

  // reads the next 2 bytes for the fee
  const feeBuf = tokenFeeToken.slice(ADDR_SIZE, OFFSET)
  const fee = feeBuf.readUIntBE(0, FEE_SIZE)

  // reads the next 20 bytes for the token address
  const tokenBBuf = tokenFeeToken.slice(OFFSET, DATA_SIZE)
  const tokenB = utils.getAddress('0x' + tokenBBuf.toString('hex'))

  return [[tokenA, tokenB], fee]
}

export function decodePath(path: string): [string[], number[]] {
  let data = Buffer.from(path.slice(2), 'hex')

  let tokens: string[] = []
  let fees: number[] = []
  let i = 0
  let finalToken: string = ''
  while (data.length >= DATA_SIZE) {
    const [[tokenA, tokenB], fee] = decodeOne(data)
    finalToken = tokenB
    tokens = [...tokens, tokenA]
    fees = [...fees, fee]
    data = data.slice((i + 1) * OFFSET)
    i += 1
  }
  tokens = [...tokens, finalToken]

  return [tokens, fees]
}
