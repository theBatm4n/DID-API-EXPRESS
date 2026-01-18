export interface ArtworkRegistration{
    cid: string,
    title: string,
    metadata: string,
}

export interface DIDResolution{
    did: string,
    cid: string,
    serviceEndpoint: string,
    walletaddress?: string,
    resolvedAt: string,
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