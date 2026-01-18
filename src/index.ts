import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { BlockchainService } from './services/blockchain';
import { APIResponse, ArtworkRegistration } from './types/did.types';
import https from 'https';
import fs from 'fs';

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
                error: 'Invalid DID format. Expected: did:art:hkust:address' 
            });
            return;
        }

        const address = parts[3];
        const blockchainData = await blockchainService.resolveDID(address);
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
        
        const now = new Date().toISOString();
        const metadata = registration.metadata as any;
        const enhancedMetadata = {
            ...metadata,
            standard: "Karen 1.0",
            created: now,
            updated: now
        }

        const cid = await uploadToIPFS(enhancedMetadata);
        console.log('Metadata uploaded to IPFS with CID:', cid);
        const result = await blockchainService.registerArtwork(cid);
        console.log('Artwork registered:', result);
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


async function fetchFromIPFS(cid: string): Promise<any> {
    try {
        // public IPFS gateway
        const gatewayUrl = `https://ipfs.io/ipfs/${cid}`;
        
        const response = await fetch(gatewayUrl, {
            headers: {
                'Accept': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`IPFS fetch failed: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return data;
        
    } catch (error) {
        console.error(`Failed to fetch from IPFS CID ${cid}:`, error);
        
        // Fallback gateways
        const fallbackGateways = [
            `https://cloudflare-ipfs.com/ipfs/${cid}`,
            `https://gateway.pinata.cloud/ipfs/${cid}`,
            `https://dweb.link/ipfs/${cid}`
        ];
        
        for (const gateway of fallbackGateways) {
            try {
                const response = await fetch(gateway, {
                    headers: { 'Accept': 'application/json' }
                });
                if (response.ok) {
                    return await response.json();
                }
            } catch (e) {
                continue;
            }
        }
        
        throw new Error(`All IPFS gateways failed for CID: ${cid}`);
    }
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
        console.log(`✅ HTTPS Server running on port ${PORT}`);
        console.log(`📝 Try: curl https://localhost:${PORT}/health`);
    });
} catch (error) {
    console.error('Failed to load SSL certificates:', error);
    console.log('Falling back to HTTP...');
    //Fallback to HTTP if cannot verify SSL
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ Server running on http://localhost:${PORT}`);
        console.log(`✅ Also accessible on http://0.0.0.0:${PORT}`);
        console.log(`📝 Try: curl http://localhost:${PORT}/health`);
    });
}
