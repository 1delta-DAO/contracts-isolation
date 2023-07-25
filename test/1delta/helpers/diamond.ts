/* global ethers */

import { ethers } from "ethers"

export const ModuleConfigAction = { Add: 0, Replace: 1, Remove: 2 }


// get function selectors from ABI
export function getContractSelectors(contract: any) {
  const signatures: any[] = Object.keys(contract.interface.functions)
  const selectors = signatures.reduce((acc, val) => {
    if (val !== 'init(bytes)') {
      acc.push(contract.interface.getSighash(val))
    }
    return acc
  }, [])
  return selectors
}

// get function selectors from ABI
export function getSelectors(contract: any) {
  const signatures: any[] = Object.keys(contract.interface.functions)
  const selectors = signatures.reduce((acc, val) => {
    if (val !== 'init(bytes)') {
      acc.push(contract.interface.getSighash(val))
    }
    return acc
  }, [])
  selectors.contract = contract
  selectors.remove = remove
  selectors.get = get
  return selectors
}

// get function selector from function signature
export function getSelector(func: any) {
  const abiInterface = new ethers.utils.Interface([func])
  return abiInterface.getSighash(ethers.utils.Fragment.from(func))
}

// used with getSelectors to remove selectors from an array of selectors
// functionNames argument is an array of function signatures
export function remove(previousSelectors: any, functionNames: any[]) {
  const selectors = previousSelectors.filter((v: any) => {
    for (const functionName of functionNames) {
      if (v === previousSelectors.contract.interface.getSighash(functionName)) {
        return false
      }
    }
    return true
  })
  selectors.contract = previousSelectors.contract
  selectors.remove = previousSelectors.remove
  selectors.get = previousSelectors.get
  return selectors
}

// used with getSelectors to get selectors from an array of selectors
// functionNames argument is an array of function signatures
export function get(previousSelectors: any, functionNames: any[]) {
  const selectors = previousSelectors.filter((v: any) => {
    for (const functionName of functionNames) {
      if (v === previousSelectors.contract.interface.getSighash(functionName)) {
        return true
      }
    }
    return false
  })
  selectors.contract = previousSelectors.contract
  selectors.remove = previousSelectors.remove
  selectors.get = previousSelectors.get
  return selectors
}

// remove selectors using an array of signatures
export function removeSelectors(selectors: string[], signatures: string[]) {
  const iface = new ethers.utils.Interface(signatures.map(v => 'function ' + v))
  const removeSelectors = signatures.map(v => iface.getSighash(v))
  selectors = selectors.filter(v => !removeSelectors.includes(v))
  return selectors
}

// find a particular address position in the return value of diamondLoupeModule.modules()
export function findAddressPositionInModules(moduleAddress: any, modules: any): number {
  for (let i = 0; i < modules.length; i++) {
    if (modules[i].moduleAddress === moduleAddress) {
      return i
    }
  }
  return -1
}