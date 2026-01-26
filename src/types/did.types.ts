export interface ArtworkRegistration{
    cid: string,
    title: string,
    metadata: string,
}

export interface DIDResolution{
    did: string,
    cid: string,
    serviceEndpoint: string,
    createdAt?: number,
    updatedAt?: number,
    walletaddress?: string,
    resolvedAt: string,
    owners?: string[],
}

export interface APIResponse<T>{
    success: boolean,
    data?: T,
    error?: string,
}

export interface ContractConfig {
    contractAddress: string,
    besuRpcUrl: string,
    privateKey: string,
}

export interface OwnershipTransfer {
    did: string;          
    newOwner: string;    
}

export interface ArtworkUpdate {
    did: string;           
    metadata: any;         
}