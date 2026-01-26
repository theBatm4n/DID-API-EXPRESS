import { ethers } from 'ethers';
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
            process.env.CONTRACT_ADDRESS || "", 
            ArtDIDRegistryABI.abi,
            this.wallet
        );
    }

    async registerArtwork(cid: string): Promise<{did: string; txHash: string}> {
        try {
            const tx = await this.contract.setRecord(cid);
            const receipt = await tx.wait();
            
            const eventTopic = ethers.id("RecordSet(bytes32,string,address,uint256)");
            const eventLog = receipt.logs.find((log: ethers.Log) => log.topics[0] === eventTopic);
            
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
        // Get FULL record instead of just latest
        const fullRecord = await this.contract.getFullRecord(did);
        
        console.log("Full record:", fullRecord);
        
        if (!fullRecord.cid || fullRecord.cid.length === 0) {
            throw new Error("DID not found");
        }
        
        const latestCid = fullRecord.cid[fullRecord.cid.length - 1];
        const currentOwner = fullRecord.owner.length > 0 
            ? fullRecord.owner[fullRecord.owner.length - 1] 
            : "";
        
        return {
            did: did,
            cid: latestCid,
            serviceEndpoint: `ipfs://${latestCid}`,
            createdAt: Number(fullRecord.created_at),
            updatedAt: Number(fullRecord.updated_at),
            walletaddress: currentOwner,
            resolvedAt: new Date().toISOString(),
            owners: fullRecord.owner,
            cidHistory: fullRecord.cid  // Add this!
        };
    } catch (error) {
        throw new Error(`Failed to resolve DID: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}

    async checkDIDExists(did: string): Promise<boolean> {
        try {
            return await this.contract.hasRecord(did);
        } catch(error) {
            throw new Error(`Failed to check DID: ${error instanceof Error? error.message : "Unknown error"}`);
        }
    }

    // NEW FUNCTIONS FOR UPDATED CONTRACT

    async updateArtwork(did: string, newCid: string): Promise<{txHash: string}> {
        try {
            const tx = await this.contract.updateRecord(did, newCid);
            const receipt = await tx.wait();
            
            return { 
                txHash: receipt.hash 
            };
            
        } catch (error: any) {
            console.error('Update error:', error);
            throw new Error(`Update transaction failed: ${error.message}`);
        }
    }

    async transferOwnership(did: string, newOwner: string): Promise<{txHash: string}> {
        try {
            const tx = await this.contract.transferOwnership(did, newOwner);
            const receipt = await tx.wait();
            
            return { 
                txHash: receipt.hash 
            };
            
        } catch (error: any) {
            console.error('Transfer error:', error);
            throw new Error(`Ownership transfer failed: ${error.message}`);
        }
    }

    async generateDID(cid: string): Promise<string> {
        try {
            return await this.contract.generateDID.staticCall(cid);
        } catch (error: any) {
            console.error('Generate DID error:', error);
            throw new Error(`Failed to generate DID: ${error.message}`);
        }
    }

    async getFullRecord(did: string): Promise<any> {
        try {
            const fullRecord = await this.contract.getFullRecord(did);
            return {
                cids: fullRecord.cid,
                createdAt: Number(fullRecord.created_at),
                updatedAt: Number(fullRecord.updated_at),
                owners: fullRecord.owner,
                cidCount: fullRecord.cid.length,
                ownerCount: fullRecord.owner.length
            };
        } catch (error: any) {
            console.error('Get full record error:', error);
            throw new Error(`Failed to get full record: ${error.message}`);
        }
    }

    async getCurrentOwner(did: string): Promise<string> {
        try {
            const [, , , owners] = await this.contract.getLatestRecord(did);
            return owners.length > 0 ? owners[owners.length - 1] : "";
        } catch (error: any) {
            console.error('Get current owner error:', error);
            throw new Error(`Failed to get current owner: ${error.message}`);
        }
    }

    async isOwner(did: string, address: string): Promise<boolean> {
        try {
            return await this.contract.isOwner(did, address);
        } catch (error: any) {
            console.error('Check owner error:', error);
            throw new Error(`Failed to check ownership: ${error.message}`);
        }
    }
}