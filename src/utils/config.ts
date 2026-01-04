export const config = {
    // Get from environment variables
    contractAddress: process.env.CONTRACT_ADDRESS || " ",  // deployed contract address on alibaba cloud besu node
    besuRpcUrl: process.env.BESU_RPC_URL, // our deployed besu node on alibaba cloud
    privateKey: process.env.PRIVATE_KEY, // default for --network=dev
    
    // Alibaba specific
    region: process.env.REGION || 'cn-hangzhou',
    accountId: process.env.ALIBABA_ACCOUNT_ID || '',
};