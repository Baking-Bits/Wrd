/**
 * Test script for ComfyUI WAN 2.2 I2V workflow
 * Tests the video generation workflow with a sample image
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Configuration
const COMFYUI_URL = 'http://192.168.1.206:8188';
const TEST_IMAGE_PATH = process.argv[2]; // Optional: path to test image
const VIDEO_PROMPT = process.argv[3] || 'camera slowly zooming in, gentle movement';

// WAN 2.2 I2V Workflow Template
const workflowTemplate = {
    "84": {
        "inputs": {
            "clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
            "type": "wan",
            "device": "default"
        },
        "class_type": "CLIPLoader"
    },
    "85": {
        "inputs": {
            "add_noise": "disable",
            "noise_seed": 0,
            "steps": 4,
            "cfg": 1,
            "sampler_name": "euler",
            "scheduler": "simple",
            "start_at_step": 2,
            "end_at_step": 4,
            "return_with_leftover_noise": "disable",
            "model": ["103", 0],
            "positive": ["98", 0],
            "negative": ["98", 1],
            "latent_image": ["86", 0]
        },
        "class_type": "KSamplerAdvanced"
    },
    "86": {
        "inputs": {
            "add_noise": "enable",
            "noise_seed": Math.floor(Math.random() * 1000000000000000),
            "steps": 4,
            "cfg": 1,
            "sampler_name": "euler",
            "scheduler": "simple",
            "start_at_step": 0,
            "end_at_step": 2,
            "return_with_leftover_noise": "enable",
            "model": ["104", 0],
            "positive": ["98", 0],
            "negative": ["98", 1],
            "latent_image": ["98", 2]
        },
        "class_type": "KSamplerAdvanced"
    },
    "87": {
        "inputs": {
            "samples": ["85", 0],
            "vae": ["90", 0]
        },
        "class_type": "VAEDecode"
    },
    "89": {
        "inputs": {
            "text": "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走",
            "clip": ["84", 0]
        },
        "class_type": "CLIPTextEncode"
    },
    "90": {
        "inputs": {
            "vae_name": "wan_2.1_vae.safetensors"
        },
        "class_type": "VAELoader"
    },
    "93": {
        "inputs": {
            "text": "",
            "clip": ["84", 0]
        },
        "class_type": "CLIPTextEncode"
    },
    "94": {
        "inputs": {
            "fps": 16,
            "images": ["87", 0]
        },
        "class_type": "CreateVideo"
    },
    "95": {
        "inputs": {
            "unet_name": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
            "weight_dtype": "default"
        },
        "class_type": "UNETLoader"
    },
    "96": {
        "inputs": {
            "unet_name": "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
            "weight_dtype": "default"
        },
        "class_type": "UNETLoader"
    },
    "98": {
        "inputs": {
            "width": 512,
            "height": 736,
            "length": 81,
            "batch_size": 1,
            "positive": ["93", 0],
            "negative": ["89", 0],
            "vae": ["90", 0],
            "start_image": ["116", 0]
        },
        "class_type": "WanImageToVideo"
    },
    "101": {
        "inputs": {
            "lora_name": "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
            "strength_model": 1.0000000000000002,
            "model": ["95", 0]
        },
        "class_type": "LoraLoaderModelOnly"
    },
    "102": {
        "inputs": {
            "lora_name": "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
            "strength_model": 1.0000000000000002,
            "model": ["96", 0]
        },
        "class_type": "LoraLoaderModelOnly"
    },
    "103": {
        "inputs": {
            "shift": 5.000000000000001,
            "model": ["102", 0]
        },
        "class_type": "ModelSamplingSD3"
    },
    "104": {
        "inputs": {
            "shift": 5.000000000000001,
            "model": ["101", 0]
        },
        "class_type": "ModelSamplingSD3"
    },
    "108": {
        "inputs": {
            "filename_prefix": "video/ComfyUI_test",
            "format": "auto",
            "codec": "auto",
            "video": ["94", 0]
        },
        "class_type": "SaveVideo"
    },
    "116": {
        "inputs": {
            "image": ""
        },
        "class_type": "ETN_LoadImageBase64"
    }
};

// Generate a simple test image (red gradient)
function generateTestImage() {
    console.log('📸 Generating test image...');
    
    // Create a simple 512x736 red-to-blue gradient as base64
    // This is a minimal PNG - in real use, A1111 would provide this
    const canvas = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        // ... (simplified - normally would be full PNG data)
    ]);
    
    // For testing, we'll just use a placeholder
    // In production, this comes from A1111's base64 output
    console.log('⚠️  Using placeholder - provide actual image via: node test-comfyui-workflow.js <image-path> "<prompt>"');
    return '';
}

// Load image from file if provided
function loadImageFromFile(filePath) {
    try {
        console.log(`📂 Loading image from: ${filePath}`);
        const imageBuffer = fs.readFileSync(filePath);
        const base64 = imageBuffer.toString('base64');
        console.log(`✅ Image loaded (${(base64.length / 1024).toFixed(2)} KB base64)`);
        return base64;
    } catch (error) {
        console.error('❌ Failed to load image:', error.message);
        return null;
    }
}

// Test ComfyUI connection
async function testConnection() {
    console.log('🔌 Testing ComfyUI connection...');
    try {
        const response = await fetch(`${COMFYUI_URL}/system_stats`, {
            timeout: 5000
        });
        
        if (response.ok) {
            const stats = await response.json();
            console.log('✅ ComfyUI is online');
            console.log('   System stats:', JSON.stringify(stats, null, 2));
            return true;
        } else {
            console.log('❌ ComfyUI returned error:', response.status);
            return false;
        }
    } catch (error) {
        console.log('❌ Cannot connect to ComfyUI:', error.message);
        return false;
    }
}

// Submit workflow to ComfyUI
async function submitWorkflow(workflow) {
    console.log('📤 Submitting workflow to ComfyUI...');
    
    try {
        const response = await fetch(`${COMFYUI_URL}/prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: workflow,
                client_id: `test_${Date.now()}`
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('✅ Workflow submitted');
        console.log('   Prompt ID:', data.prompt_id);
        return data.prompt_id;
        
    } catch (error) {
        console.error('❌ Workflow submission failed:', error.message);
        throw error;
    }
}

// Poll for completion
async function pollForCompletion(promptId) {
    console.log('⏳ Waiting for video generation to complete...');
    const startTime = Date.now();
    const maxAttempts = 180; // 15 minutes
    let attempts = 0;

    while (attempts < maxAttempts) {
        attempts++;
        
        try {
            const response = await fetch(`${COMFYUI_URL}/history/${promptId}`);
            
            if (!response.ok) {
                console.log(`   [${attempts}] Waiting... (${Math.round((Date.now() - startTime) / 1000)}s)`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            const history = await response.json();
            
            if (!history[promptId]) {
                console.log(`   [${attempts}] Processing... (${Math.round((Date.now() - startTime) / 1000)}s)`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            const promptData = history[promptId];
            
            // Check for errors
            if (promptData.status && promptData.status.status_str === 'error') {
                console.error('❌ Workflow error:', JSON.stringify(promptData.status, null, 2));
                throw new Error('ComfyUI workflow failed');
            }

            // Check if completed
            if (promptData.outputs) {
                const duration = Math.round((Date.now() - startTime) / 1000);
                console.log(`✅ Video generation completed in ${duration}s`);
                
                // Find video output
                const saveVideoOutput = promptData.outputs["108"];
                if (!saveVideoOutput || !saveVideoOutput.gifs || saveVideoOutput.gifs.length === 0) {
                    throw new Error('No video output found');
                }

                const videoInfo = saveVideoOutput.gifs[0];
                console.log('📹 Video info:', videoInfo);
                console.log(`   Filename: ${videoInfo.filename}`);
                console.log(`   Subfolder: ${videoInfo.subfolder || '(root)'}`);
                console.log(`   Type: ${videoInfo.type}`);
                
                const videoUrl = `${COMFYUI_URL}/view?filename=${videoInfo.filename}&subfolder=${videoInfo.subfolder || ''}&type=output`;
                console.log(`   URL: ${videoUrl}`);
                
                return videoInfo;
            }

            console.log(`   [${attempts}] Processing... (${Math.round((Date.now() - startTime) / 1000)}s)`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            
        } catch (error) {
            console.error('❌ Polling error:', error.message);
            throw error;
        }
    }

    throw new Error('Video generation timeout');
}

// Main test function
async function runTest() {
    console.log('='.repeat(80));
    console.log('🎬 ComfyUI WAN 2.2 I2V Workflow Test');
    console.log('='.repeat(80));
    console.log();
    
    // Test connection
    const connected = await testConnection();
    if (!connected) {
        console.log('\n❌ Cannot proceed without ComfyUI connection');
        process.exit(1);
    }
    
    console.log();
    
    // Load or generate image
    let imageBase64;
    if (TEST_IMAGE_PATH) {
        imageBase64 = loadImageFromFile(TEST_IMAGE_PATH);
        if (!imageBase64) {
            console.log('\n❌ Cannot proceed without valid image');
            process.exit(1);
        }
    } else {
        console.log('⚠️  No image provided - workflow will need actual image data');
        console.log('   Usage: node test-comfyui-workflow.js <image-path> "<video-prompt>"');
        console.log('   Example: node test-comfyui-workflow.js test.png "camera slowly zooming in"');
        console.log();
        console.log('❌ Cannot proceed without test image');
        process.exit(1);
    }
    
    console.log();
    
    // Prepare workflow
    console.log('🔧 Preparing workflow...');
    const workflow = JSON.parse(JSON.stringify(workflowTemplate));
    workflow["116"].inputs.image = imageBase64;
    workflow["93"].inputs.text = VIDEO_PROMPT;
    console.log(`   Image size: ${(imageBase64.length / 1024).toFixed(2)} KB`);
    console.log(`   Video prompt: "${VIDEO_PROMPT}"`);
    
    console.log();
    
    // Submit workflow
    try {
        const promptId = await submitWorkflow(workflow);
        console.log();
        
        // Poll for completion
        const videoInfo = await pollForCompletion(promptId);
        
        console.log();
        console.log('='.repeat(80));
        console.log('✅ TEST COMPLETED SUCCESSFULLY');
        console.log('='.repeat(80));
        console.log();
        console.log('Video can be downloaded from:');
        console.log(`${COMFYUI_URL}/view?filename=${videoInfo.filename}&subfolder=${videoInfo.subfolder || ''}&type=output`);
        
    } catch (error) {
        console.log();
        console.log('='.repeat(80));
        console.log('❌ TEST FAILED');
        console.log('='.repeat(80));
        console.log('Error:', error.message);
        process.exit(1);
    }
}

// Run the test
runTest().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
