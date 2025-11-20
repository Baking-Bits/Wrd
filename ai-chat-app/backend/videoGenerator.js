/**
 * Video Generator
 * Handles ComfyUI (WAN 2.2 Image-to-Video) for background processing
 */

const fetch = require('node-fetch');

class VideoGenerator {
    constructor(config) {
        this.comfyuiUrl = config.comfyuiUrl || 'http://192.168.1.206:8188';
        this.dockerManager = config.dockerManager; // Optional Docker management
        this.timeout = config.timeout || 900000; // 15 minutes for video generation
        
        // ComfyUI workflow template (WAN 2.2 I2V)
        this.workflowTemplate = {
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
                    "noise_seed": 701774155778889,
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
                    "filename_prefix": "video/ComfyUI",
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
    }

    /**
     * Generate a video from an image and motion prompt
     */
    async generate(base64Image, videoPrompt = "") {
        console.log(`🎬 Starting video generation from image`);
        console.log(`   Video prompt: "${videoPrompt}"`);
        
        // Start ComfyUI Docker container if dockerManager available
        if (this.dockerManager) {
            try {
                await this.dockerManager.startContainer('ComfyUI-Nvidia-Docker');
                console.log('✅ ComfyUI container started');
                
                // Wait for initialization
                await new Promise(resolve => setTimeout(resolve, 10000));
            } catch (error) {
                console.warn('⚠️ ComfyUI container start warning:', error.message);
            }
        }

        // Get image dimensions from base64
        let width = 512, height = 736; // Defaults (phone format)
        try {
            const imageBuffer = Buffer.from(base64Image.split(',')[1], 'base64');
            const sizeOf = require('image-size');
            const dimensions = sizeOf(imageBuffer);
            width = dimensions.width;
            height = dimensions.height;
        } catch (e) {
            console.warn('Could not determine image dimensions, using defaults.', e.message);
        }

        // Prepare workflow with image, prompt, and dynamic ratio
        const workflow = this.prepareWorkflow(base64Image, videoPrompt, width, height);

        // Retry logic for workflow submission
        const maxRetries = 3;
        let lastError = null;
        let promptId = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                promptId = await this.submitWorkflow(workflow);
                console.log(`📤 Workflow submitted, prompt ID: ${promptId}`);
                break;
            } catch (error) {
                lastError = error;
                console.warn(`❌ ComfyUI workflow submission failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retry
                }
            }
        }
        if (!promptId) {
            console.error('❌ Video generation failed: Could not submit workflow after retries');
            throw lastError || new Error('Unknown error submitting workflow');
        }

        // Poll for completion
        const videoData = await this.pollForCompletion(promptId);
        console.log('✅ Video generated successfully');

        // Save video file to media folder
        const fs = require('fs');
        const path = require('path');
        const uuid = require('crypto').randomUUID;
        const mediaDir = process.env.LOCAL_VIDEO_PATH || path.join(__dirname, 'media');
        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
        const filename = `video_${Date.now()}_${uuid()}.mp4`;
        const filePath = path.join(mediaDir, filename);
        // Remove base64 prefix if present
        let base64Str = videoData;
        if (base64Str.startsWith('data:')) base64Str = base64Str.split(',')[1];
        fs.writeFileSync(filePath, Buffer.from(base64Str, 'base64'));
        console.log('✅ Video file saved:', filePath);

        return {
            videoPath: filePath,
            filename,
            width,
            height,
            videoPrompt: videoPrompt
        };
    }

    /**
     * Prepare workflow by injecting image and prompt
     */
    prepareWorkflow(base64Image, videoPrompt) {
        const workflow = JSON.parse(JSON.stringify(this.workflowTemplate)); // Deep clone

        // Strip data URL prefix if present (data:image/png;base64,...)
        let imageData = base64Image;
        if (imageData.startsWith('data:')) {
            imageData = imageData.split(',')[1];
        }

        // Inject image into node 116 (ETN_LoadImageBase64)
        workflow["116"].inputs.image = imageData;

        // Inject video prompt into node 93 (CLIP Text Encode - Positive Prompt)
        workflow["93"].inputs.text = videoPrompt;

        // Dynamic ratio
        if (arguments.length >= 4) {
            workflow["98"].inputs.width = arguments[2];
            workflow["98"].inputs.height = arguments[3];
        }

        // Randomize noise seed for variation
        workflow["86"].inputs.noise_seed = Math.floor(Math.random() * 1000000000000000);

        console.log('🔧 Workflow prepared with image, prompt, and ratio');
        return workflow;
    }

    /**
     * Submit workflow to ComfyUI API
     */
    async submitWorkflow(workflow) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for submission

        try {
            const response = await fetch(`${this.comfyuiUrl}/prompt`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: workflow,
                    client_id: `nodejs_${Date.now()}`
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`ComfyUI API error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            
            if (!data.prompt_id) {
                throw new Error('No prompt_id returned from ComfyUI');
            }

            return data.prompt_id;
            
        } catch (error) {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                throw new Error('Workflow submission timeout');
            }
            
            throw error;
        }
    }

    /**
     * Poll ComfyUI for workflow completion
     */
    async pollForCompletion(promptId) {
        console.log(`⏳ Polling for completion of prompt ${promptId}`);
        const startTime = Date.now();
        const maxAttempts = 180; // 15 minutes at 5s intervals
        let attempts = 0;

        while (attempts < maxAttempts) {
            attempts++;
            
            // Check if timeout reached
            if (Date.now() - startTime > this.timeout) {
                throw new Error('Video generation timeout');
            }

            try {
                // Get history for this prompt
                const response = await fetch(`${this.comfyuiUrl}/history/${promptId}`);
                
                if (!response.ok) {
                    console.warn(`⚠️ History check failed: ${response.status}`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }

                const history = await response.json();
                
                // Check if prompt exists in history
                if (!history[promptId]) {
                    console.log(`   [${attempts}/${maxAttempts}] Waiting... (${Math.round((Date.now() - startTime) / 1000)}s)`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }

                const promptData = history[promptId];
                
                // Check for errors
                if (promptData.status && promptData.status.status_str === 'error') {
                    throw new Error(`ComfyUI workflow error: ${JSON.stringify(promptData.status)}`);
                }

                // Check if completed
                if (promptData.outputs) {
                    console.log(`✅ Workflow completed after ${Math.round((Date.now() - startTime) / 1000)}s`);
                    console.log('📊 ComfyUI outputs:', JSON.stringify(promptData.outputs, null, 2));
                    
                    // Find video output from SaveVideo node (108)
                    const saveVideoOutput = promptData.outputs["108"];
                    console.log('🎬 Node 108 output:', JSON.stringify(saveVideoOutput, null, 2));

                    let videoInfo = null;
                    // Prefer gifs if present
                    if (saveVideoOutput && saveVideoOutput.gifs && saveVideoOutput.gifs.length > 0) {
                        videoInfo = saveVideoOutput.gifs[0];
                    } else if (saveVideoOutput && saveVideoOutput.images && saveVideoOutput.images.length > 0) {
                        // Look for .mp4 in images array
                        videoInfo = saveVideoOutput.images.find(img => img.filename && img.filename.endsWith('.mp4'));
                    }

                    if (!videoInfo) {
                        // Try to find ANY video output in any node
                        console.log('⚠️ Node 108 not found or no gifs/images, searching all outputs...');
                        const allNodeIds = Object.keys(promptData.outputs);
                        console.log('📋 Available output nodes:', allNodeIds);
                        for (const nodeId of allNodeIds) {
                            const output = promptData.outputs[nodeId];
                            console.log(`   Node ${nodeId}:`, Object.keys(output));
                            if (output.gifs && output.gifs.length > 0) {
                                videoInfo = output.gifs[0];
                                break;
                            } else if (output.images && output.images.length > 0) {
                                videoInfo = output.images.find(img => img.filename && img.filename.endsWith('.mp4'));
                                if (videoInfo) break;
                            }
                        }
                    }

                    if (!videoInfo) {
                        throw new Error('No video output found in workflow result');
                    }

                    // Download the video
                    const videoUrl = `${this.comfyuiUrl}/view?filename=${videoInfo.filename}&subfolder=${videoInfo.subfolder || ''}&type=output`;
                    console.log(`📥 Downloading video from: ${videoUrl}`);
                    const videoData = await this.downloadVideo(videoUrl);
                    return videoData;
                }

                console.log(`   [${attempts}/${maxAttempts}] Processing... (${Math.round((Date.now() - startTime) / 1000)}s)`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                
            } catch (error) {
                if (error.message.includes('ComfyUI workflow error') || error.message.includes('No video output')) {
                    throw error;
                }
                console.warn(`⚠️ Polling error: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        throw new Error('Video generation exceeded maximum polling attempts');
    }

    /**
     * Download video from ComfyUI
     */
    async downloadVideo(videoUrl) {
        console.log('📥 Downloading video file...');
        
        const response = await fetch(videoUrl);
        
        if (!response.ok) {
            throw new Error(`Video download failed: ${response.status}`);
        }

        const buffer = await response.buffer();
        const base64Video = buffer.toString('base64');
        
        console.log(`✅ Video downloaded (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
        
        // Return as data URL
        return `data:video/mp4;base64,${base64Video}`;
    }

    /**
     * Update configuration
     */
    updateConfig(config) {
        if (config.comfyuiUrl) this.comfyuiUrl = config.comfyuiUrl;
        if (config.timeout) this.timeout = config.timeout;
    }
}

module.exports = VideoGenerator;
