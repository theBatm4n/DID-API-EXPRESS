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
            process.env.CONTRACT_ADDRESS || " ", 
            ArtDIDRegistryABI.abi,
            this.wallet
        );
    }

    async registerArtwork(cid: string): Promise<{did: string; txHash: string}> {
        try {
            const tx = await this.contract.setRecord(cid);
            const receipt = await tx.wait();
            
            const eventTopic = ethers.id("RecordSet(bytes32,string,address,uint256,uint256)");
            const eventLog = receipt.logs.find((log : ethers.Log) => log.topics[0] === eventTopic);
            let actualDid = "";
            if (eventLog) {
                actualDid = ethers.hexlify(eventLog.topics[1]); 
            }
            
            return { 
                did: actualDid, 
                txHash: receipt.hash 
            };
            
        } catch (error: any) {
            console.error('Registration error:', error);
            throw new Error(`Blockchain transaction failed: ${error.message}`);
        }
    }

    async resolveDID(did: string): Promise<DIDResolution> {
        try {
            const [cid, createdAt, updatedAt, creator] = await this.contract.getRecord(did);
            console.log("DID resolved. CID:", cid);
            if (!cid || cid === "" || cid === "0x") {
                throw new Error("DID not found");
            }
            
            return {
                did: did,
                cid,
                serviceEndpoint: `ipfs://${cid}`,
                createdAt: Number(createdAt),
                updatedAt: Number(updatedAt),
                walletaddress: creator,
                resolvedAt: new Date().toISOString(),
            };

        } catch (error) {
            throw new Error(`Failed to resolve DID: ${error instanceof Error ? error.message : "Unknown error"}`);
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