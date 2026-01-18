import { ethers } from 'ethers';
import { config } from '../utils/config';
import "dotenv/config";
import { DIDResolution } from '../types/did.types';
import ArtDIDRegistryABI from '../../contracts/ABI.json';

export class BlockchainService {
    private provider: ethers.JsonRpcProvider;
    private contract: ethers.Contract;
    private wallet: ethers.Wallet;

    constructor() {

        if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY.length !== 66) {
            throw new Error('Invalid private key configuration');
        }
        this.provider = new ethers.JsonRpcProvider(process.env.BESU_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS || " ", //contract address
            ArtDIDRegistryABI.abi,
            this.wallet
        );
    }

    // Check your contract initialization
async registerArtwork(cid: string): Promise<{did: string; txHash: string}> {
    try {
        
        const tx = await this.contract.setRecord(cid);
        console.log(`Transaction sent: ${tx.hash}`);
        
        const receipt = await tx.wait();
        console.log(`Transaction confirmed in block: ${receipt.blockNumber}`);
        
        // Try with a simpler call first
        const did = await this.contract.generateDID(cid);
        console.log(`Artwork registered with DID: ${did}, Transaction Hash: ${receipt.transactionHash}`);
        
        return { did, txHash: receipt.transactionHash };
    }
    catch(error: any) {
        console.error('Full error details:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        console.error('Transaction data:', error.transaction);
        
        throw new Error(`Blockchain transaction failed: ${error.message}`);
    }
}

    async resolveDID(did: string): Promise<DIDResolution>{
        try{
            console.log(`Trying to get record: ${did}`);
            const cid = await this.contract.getRecord(did);
            console.log(`Record found: ${cid}`);
            if(!cid || cid === ""){
                throw new Error("DID not found");
            }

            return{
                did,
                cid,
                serviceEndpoint: `ipfs://${cid}`,
                walletaddress: await this.wallet.getAddress(),
                resolvedAt: new Date().toISOString(),
            };

        } catch(error){
            throw new Error(`Failed to resolve DID: ${error instanceof Error? error.message : "Unknown error"}`);
        }
    }

    async checkDIDExists(did: string): Promise<boolean>{
        try{
            return await this.contract.hasRecord(did);
        } catch(error){
            throw new Error(`Failed to check DID: ${error instanceof Error? error.message : "Unknown error"}`);
        }
    }
}