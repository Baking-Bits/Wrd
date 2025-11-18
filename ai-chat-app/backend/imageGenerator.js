/**
 * Image Generator
 * Handles A1111 (Stable Diffusion) image generation for background processing
 */

const fetch = require('node-fetch');

class ImageGenerator {
    constructor(config) {
        this.a1111Url = config.a1111Url || 'http://192.168.1.206:7860';
        this.dockerManager = config.dockerManager; // Optional Docker management
        this.timeout = config.timeout || 600000; // 10 minutes for image generation
    }

    /**
     * Generate an image from a text prompt
     */
    async generate(prompt) {
        console.log(`🎨 Starting image generation: "${prompt}"`);
        
        // Start A1111 Docker container if dockerManager available
        if (this.dockerManager) {
            try {
                await this.dockerManager.startContainer('AUTOMATIC1111-Stable-Diffusion-Web-UI');
                console.log('✅ A1111 container started');
                
                // Wait for initialization
                await new Promise(resolve => setTimeout(resolve, 15000));
            } catch (error) {
                console.warn('⚠️ A1111 container start warning:', error.message);
            }
        }

        // Enhance prompt for better results
        const enhancedPrompt = this.enhancePrompt(prompt);
        
        try {
            const imageData = await this.callA1111(enhancedPrompt);
            console.log('✅ Image generated successfully');
            
            return {
                base64Image: `data:image/png;base64,${imageData}`,
                prompt: enhancedPrompt
            };
            
        } catch (error) {
            console.error('❌ Image generation failed:', error.message);
            throw error;
        }
    }

    /**
     * Call A1111 API for image generation
     */
    async callA1111(prompt) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(`${this.a1111Url}/sdapi/v1/txt2img`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: prompt,
                    negative_prompt: "cartoon, anime, drawing, painting, sketch, rendered, CGI, 3D render, illustration, fake, artificial, oversaturated, HDR, unrealistic lighting, watermark, text, signature, blurry, low quality, distorted",
                    steps: 20,
                    sampler_name: 'DPM++ 2M',
                    cfg_scale: 7,
                    width: 576,
                    height: 768
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`A1111 API error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            
            if (!data.images || data.images.length === 0) {
                throw new Error('No image returned from A1111');
            }

            return data.images[0]; // Base64 string
            
        } catch (error) {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                throw new Error('Image generation timeout');
            }
            
            throw error;
        }
    }

    /**
     * Enhance prompt with realistic photography tags
     */
    enhancePrompt(prompt) {
        const enhancements = [
            'professional photography',
            'natural lighting',
            'high detail',
            'sharp focus',
            'realistic',
            '8k uhd',
            'photorealistic'
        ];

        // Check if prompt already has quality tags
        const hasQualityTags = enhancements.some(tag => 
            prompt.toLowerCase().includes(tag.toLowerCase())
        );

        if (hasQualityTags) {
            return prompt; // Already enhanced
        }

        // Add enhancements
        return `${prompt}, ${enhancements.join(', ')}`;
    }

    /**
     * Update configuration
     */
    updateConfig(config) {
        if (config.a1111Url) this.a1111Url = config.a1111Url;
        if (config.timeout) this.timeout = config.timeout;
        if (config.dockerManager) this.dockerManager = config.dockerManager;
    }
}

module.exports = ImageGenerator;
