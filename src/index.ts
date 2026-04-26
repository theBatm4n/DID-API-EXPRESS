import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { BlockchainService } from './services/blockchain';
import { APIResponse, ArtworkRegistration, OwnershipTransfer, ArtworkUpdate } from './types/did.types';
import https from 'https';
import fs from 'fs';
import multer from 'multer';

// multer for memory storage (buffers)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB per file (adjust)
        files: 10                    // Max 10 files per request
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/tiff', 'application/pdf'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, TIFF, PDF allowed.'));
        }
    }
});

const app = express();
const blockchainService = new BlockchainService();

app.use(cors());
app.use(express.json());
// Health check - GET
app.get('/health', (req, res) => {
    res.json({
        status: "healthy",
        timeStamp: new Date().toISOString(),
        service: 'ArtDID Registry API'
    });
});

// Resolve DID - GET
app.get('/resolve', async (req, res) => {
    try {
        const did = req.query.did as string;
        if (!did) {
            res.status(400).json({ 
                success: false,
                error: 'DID parameter is required' 
            });
            return;
        }
        
        const parts = did.split(':');
        if (parts.length < 4 || parts[0] !== 'did' || parts[1] !== 'art' || parts[2] != "hkust") {
            res.status(400).json({ 
                success: false,
                error: 'Invalid DID format. Expected: did:art:hkust:<hash>' 
            });
            return;
        }

        const hash = parts[3];
        const blockchainData = await blockchainService.resolveDID(hash);
        const cid = blockchainData.cid;
        
        let ipfsMetadata = null;
        let ipfsError = null;
        
        try {
            ipfsMetadata = await fetchFromIPFS(cid);
        } catch (error) {
            console.error('IPFS fetch error:', error);
            ipfsError = error instanceof Error ? error.message : 'IPFS fetch failed';
        }
        
        res.json({
            responseCode: 0,
            id: did,
            blockchainData,
            ipfsMetadata,
            ipfsError
        });
    } catch (error) {
        console.error('Error resolving DID:', error);
        const err = error instanceof Error ? error.message : 'Unknown error';
        
        if (err.includes('not found')) {
            res.status(404).json({ success: false, error: err });
        } else {
            res.status(500).json({ success: false, error: err });
        }
    }
});

// Check DID exists - GET
app.get('/check', async (req, res) => {
    try {
        const did = req.query.did as string;
        if (!did) {
            res.status(400).json({ 
                success: false,
                error: 'DID parameter is required' 
            });
            return;
        }
        const exists = await blockchainService.checkDIDExists(did);
        const response: APIResponse<{ exists: boolean }> = {
            success: true,
            data: { exists }
        };
        res.json(response);
    } catch (error) {
        const response: APIResponse<null> = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(response);
    }
});

// Register artwork - POST
app.post('/register', async (req, res) => {
    try {
        const registration: ArtworkRegistration = req.body;
        if (!registration.metadata) {
            res.status(400).json({ 
                success: false,
                error: 'Artwork metadata is required' 
            });
            return;
        }
        const metadata = registration.metadata as any;
        const enhancedMetadata = {
            ...metadata,
            standard: "Karen 1.0",
        }

        const cid = await uploadToIPFS(enhancedMetadata);
        const result = await blockchainService.registerArtwork(cid);
        const response: APIResponse<{ 
            did: string; 
            standard: string;
            txHash: string; 
            cid: string;
            ipfsUrl: string;
            metadata: any;
        }> = {
            success: true,
            data: {
                did: `did:art:hkust:${result.did}`,
                standard: "Karen 1.0",
                txHash: result.txHash,
                cid: cid,
                ipfsUrl: `https://ipfs.io/ipfs/${cid}`,
                metadata: metadata
            }
        };
        res.json(response);
    } catch (error) {
        console.error('Artwork registration error:', error);
        const response: APIResponse<null> = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(response);
    }
});


// Update artwork metadata - PUT
app.put('/update', async (req, res) => {
    try {
        const update: ArtworkUpdate = req.body;
        if (!update.did || !update.metadata) {
            res.status(400).json({ 
                success: false,
                error: 'DID and metadata are required' 
            });
            return;
        }
        
        // Parse DID to get the hash part
        const parts = update.did.split(':');
        if (parts.length < 4 || parts[0] !== 'did' || parts[1] !== 'art' || parts[2] !== "hkust") {
            res.status(400).json({ 
                success: false,
                error: 'Invalid DID format. Expected: did:art:hkust:<hash>' 
            });
            return;
        }
        
        const didHash = parts[3];
        
        // Get current record to know the version
        const fullRecord = await blockchainService.getFullRecord(didHash);
        const currentVersion = fullRecord.cidCount;
        
        // Prepare new metadata
        const now = new Date().toISOString();
        const metadata = update.metadata as any;
        const enhancedMetadata = {
            ...metadata,
            standard: "Karen 2.0",
            created: fullRecord.createdAt ? new Date(fullRecord.createdAt * 1000).toISOString() : now,
            updated: now,
            version: currentVersion + 1,
            previousVersion: currentVersion
        };

        // Upload new metadata to IPFS
        const newCid = await uploadToIPFS(enhancedMetadata);
        console.log('Updated metadata uploaded to IPFS with CID:', newCid);
        
        // Update blockchain record
        const result = await blockchainService.updateArtwork(didHash, newCid);
        console.log('Artwork updated:', result);
        
        const response: APIResponse<{ 
            did: string;
            txHash: string; 
            newCid: string;
            previousCid: string;
            ipfsUrl: string;
            version: number;
            metadata: any;
        }> = {
            success: true,
            data: {
                did: update.did,
                txHash: result.txHash,
                newCid: newCid,
                previousCid: fullRecord.cids[fullRecord.cids.length - 1],
                ipfsUrl: `https://ipfs.io/ipfs/${newCid}`,
                version: currentVersion + 1,
                metadata: metadata
            }
        };
        res.json(response);
    } catch (error) {
        console.error('Artwork update error:', error);
        const response: APIResponse<null> = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(response);
    }
});

app.post('/add-scanned-document', upload.array('documents', 10), async (req, res) => {
    try {
        const { did, ownerAddress } = req.body;
        const files = req.files as Express.Multer.File[];

        if (!did || !ownerAddress) {
            return res.status(400).json({ success: false, error: 'did and ownerAddress are required' });
        }
        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one document file is required' });
        }

        // 1. Validate DID format
        const parts = did.split(':');
        if (parts.length !== 4 || parts[0] !== 'did' || parts[1] !== 'art' || parts[2] !== 'hkust') {
            return res.status(400).json({ success: false, error: 'Invalid DID format' });
        }
        const didHash = parts[3];

        // 2. Verify ownership
        const isOwner = await blockchainService.isOwner(didHash, ownerAddress);
        if (!isOwner) {
            return res.status(403).json({ success: false, error: 'Only the current owner can add documents' });
        }

        // 3. Get current artwork record from blockchain
        const fullRecord = await blockchainService.getFullRecord(didHash);
        const currentBundleCid = fullRecord.cids[fullRecord.cids.length - 1];

        // 4. Fetch existing bundle from IPFS
        let existingBundle: any = {};
        try {
            existingBundle = await fetchFromIPFS(currentBundleCid);
        } catch (err) {
            // If no bundle yet, create empty structure
            existingBundle = {
                schema: "did-art-bundle-v2",
                version: "1.0.0",
                documents: [],
                metadata: {}
            };
        }

        // 5. Process each uploaded file: upload to IPFS (as a single buffer for now)
        //    But we store in a structure that supports future chunking and encryption.
        const addedDocs = [];
        for (const file of files) {
            // For now, upload entire file as a single IPFS object.
            // Later you can replace this with chunked upload.
            const fileCid = await uploadBufferToIPFS(file.buffer);
            
            const docEntry = {
                cid: fileCid,
                name: file.originalname,
                mimeType: file.mimetype,
                size: file.size,            // Points to the raw file in IPFS
                addedAt: new Date().toISOString(),
                addedBy: ownerAddress,
                encrypted: false,             // Placeholder for future
                // For chunked future:
                chunked: false,
                totalChunks: 1,
                chunks: [{ index: 0, cid: fileCid }]
            };
            addedDocs.push(docEntry);
        }

        // 6. Merge into existing bundle
        const updatedBundle = {
            ...existingBundle,
            documents: [...(existingBundle.documents || []), ...addedDocs],
            lastUpdated: new Date().toISOString(),
            updateHistory: [
                ...(existingBundle.updateHistory || []),
                {
                    action: 'ADD_DOCUMENTS',
                    timestamp: new Date().toISOString(),
                    documentsAdded: addedDocs.map(d => d.cid),
                    by: ownerAddress
                }
            ]
        };

        // 7. Upload updated bundle to IPFS (new CID)
        const newBundleCid = await uploadToIPFS(updatedBundle);
        console.log('New bundle CID:', newBundleCid);

        // 8. Update blockchain record (creates new version)
        const txResult = await blockchainService.updateArtwork(didHash, newBundleCid);
        console.log('Blockchain updated with new bundle CID:', txResult);
        // 9. Return success
        res.json({
            success: true,
            data: {
                did: did,
                txHash: txResult.txHash,
                oldBundleCid: currentBundleCid,
                newBundleCid: newBundleCid,
                documentsAdded: addedDocs.map(d => ({ name: d.name, cid: d.cid })),
                totalDocuments: updatedBundle.documents.length,
                version: fullRecord.cidCount + 1
            }
        });

    } catch (error) {
        console.error('Error adding scanned document:', error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
});

// Transfer ownership - POST
app.post('/transfer', async (req, res) => {
    try {
        const transfer: OwnershipTransfer = req.body;
        if (!transfer.did || !transfer.newOwner) {
            res.status(400).json({ 
                success: false,
                error: 'DID and newOwner are required' 
            });
            return;
        }
        
        // Parse DID to get the hash part
        const parts = transfer.did.split(':');
        if (parts.length < 4 || parts[0] !== 'did' || parts[1] !== 'art' || parts[2] !== "hkust") {
            res.status(400).json({ 
                success: false,
                error: 'Invalid DID format. Expected: did:art:hkust:<hash>' 
            });
            return;
        }
        
        const didHash = parts[3];
        
        // Validate Ethereum address format
        if (!transfer.newOwner.match(/^0x[a-fA-F0-9]{40}$/)) {
            res.status(400).json({ 
                success: false,
                error: 'Invalid Ethereum address format' 
            });
            return;
        }
        
        // Transfer ownership
        const result = await blockchainService.transferOwnership(didHash, transfer.newOwner);
        console.log('Ownership transferred:', result);
        
        // Get updated record
        const fullRecord = await blockchainService.getFullRecord(didHash);
        const currentOwner = await blockchainService.getCurrentOwner(didHash);
        
        const response: APIResponse<{ 
            did: string;
            txHash: string;
            previousOwner: string;
            newOwner: string;
            currentOwner: string;
            totalOwners: number;
        }> = {
            success: true,
            data: {
                did: transfer.did,
                txHash: result.txHash,
                previousOwner: fullRecord.owners[fullRecord.owners.length - 2] || "N/A",
                newOwner: transfer.newOwner,
                currentOwner: currentOwner,
                totalOwners: fullRecord.ownerCount
            }
        };
        res.json(response);
    } catch (error) {
        console.error('Ownership transfer error:', error);
        const response: APIResponse<null> = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
        
        // Check for specific errors
        if (error instanceof Error) {
            if (error.message.includes('Only current owner can transfer')) {
                res.status(403).json(response);
                return;
            }
            if (error.message.includes('Address is already an owner')) {
                res.status(400).json(response);
                return;
            }
        }
        
        res.status(500).json(response);
    }
});

async function fetchFromIPFS(cid: string): Promise<any> {
    // First Try our own IPFS node (most reliable)
    if (process.env.IPFS_API_URL) {
        try {
            console.log(`Fetching from local IPFS node: ${cid}`);
            const response = await fetch(`${process.env.IPFS_API_URL}/api/v0/cat?arg=${cid}`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json'
                },
                signal: AbortSignal.timeout(5000) // 5 second timeout
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log(`Successfully fetched from local IPFS node: ${cid}`);
                return data;
            }
        } catch (error) {
            console.log(`Local IPFS node fetch failed for ${cid}:`, error);
        }
    }
    
    console.log(`Trying public gateways for: ${cid}`);
    const gateways = [
        `https://cloudflare-ipfs.com/ipfs/${cid}`,  // Most reliable
        `https://dweb.link/ipfs/${cid}`,
        `https://gateway.pinata.cloud/ipfs/${cid}`,
        `https://ipfs.io/ipfs/${cid}`  // Least reliable, last resort
    ];
    
    for (const gatewayUrl of gateways) {
        try {
            console.log(`Trying gateway: ${gatewayUrl}`);
            const response = await fetch(gatewayUrl, {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(3000)
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log(`Successfully fetched from public gateway: ${gatewayUrl}`);
                return data;
            }
        } catch (error) {
            console.log(`Gateway ${gatewayUrl} failed:`, error);
            continue;
        }
    }
    throw new Error(`All IPFS sources failed for CID: ${cid}`);
}

async function uploadToIPFS(metadata: any): Promise<string> {
  try {
    const jsonString = JSON.stringify(metadata, null, 2);
    const formData = new FormData();
    const blob = new Blob([jsonString], { type: 'application/json' });
    formData.append('file', blob);
    const response = await fetch(`${process.env.IPFS_API_URL}/api/v0/add`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`IPFS upload failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json() as { Hash?: string };
    if (!result || typeof result.Hash !== 'string') {
      throw new Error(`Unexpected IPFS response: ${JSON.stringify(result)}`);
    }
    console.log('IPFS upload result:', result);
    return result.Hash;
    
  } catch (error) {
    console.error('IPFS upload error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`IPFS upload failed: ${msg}`);
  }
}

async function uploadBufferToIPFS(buffer: Buffer) : Promise<string> {
    const formData = new FormData();
    const blob = new Blob([buffer]);
    formData.append('file', blob);
    const response = await fetch(`${process.env.IPFS_API_URL}/api/v0/add`, {
        method: `POST`,
        body: formData
    });
    if(!response.ok){
        throw new Error(`IPFS upload failed: ${response.statusText}`);
    }
    const result = await response.json() as { Hash: string};
    return result.Hash;
}

const PORT = parseInt(process.env.PORT || '9001', 10);
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || ' ';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || ' ';

try {
    const privateKey = fs.readFileSync(SSL_KEY_PATH, 'utf8');
    const certificate = fs.readFileSync(SSL_CERT_PATH, 'utf8');

    const credentials = {
        key: privateKey,
        cert: certificate
    };

    const httpsServer = https.createServer(credentials, app);
    httpsServer.listen(PORT, '0.0.0.0', () => {
        console.log(`HTTPS Server running on port ${PORT}`);
        console.log(`Try: curl https://localhost:${PORT}/health`);
    });
} catch (error) {
    console.error('Failed to load SSL certificates:', error);
    console.log('Falling back to HTTP...');
    //Fallback to HTTP if cannot verify SSL (for local testing)
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log(`Also accessible on http://0.0.0.0:${PORT}`);
        console.log(`Try: curl http://localhost:${PORT}/health`);
    });
}
