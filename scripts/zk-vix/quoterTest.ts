


    import '@nomiclabs/hardhat-ethers'
    import hre from 'hardhat'
    import { FeeAmount } from '../../test/uniswap-v3/core/shared/utilities';
    import { encodePath } from '../../test/uniswap-v3/periphery/shared/path';
    import { AggregationQuoter__factory } from '../../types';
    
    
    const usdtAddress = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d"
    const usdcAddress = "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035"
    const daiAddress = '0xC5015b9d9161Dca7e18e32f6f25C4aD850731Fd4'
    const wethAddress = '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9'
    const wbtcAddress = '0xEA034fb02eB1808C2cc3adbC15f447B93CbE08e1'
    
    async function main() {
    
        const accounts = await hre.ethers.getSigners()
        const operator = accounts[0]
        const chainId = await operator.getChainId();
    
        console.log("Deploy quoter on", chainId, "by", operator.address)
    
        const quoter = await new AggregationQuoter__factory(operator).attach(
            '0xf9b36A3FAFa4AD006b360b3CDdb7DAA72F299180'
            )
            
        console.log('Addresses')
        console.log('quoter:', quoter.address)
    
        const path = encodePath(
            [usdcAddress, wbtcAddress, wethAddress],
            [FeeAmount.MEDIUM, FeeAmount.ALGEBRA]
    
        )
    
        const swapAmount = 10000000
        const quote = await quoter.callStatic.quoteExactInput(path, swapAmount)
        console.log("Quote received", quote.toString())
    
    }
    
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
    
    