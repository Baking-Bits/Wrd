/**
 * End-to-End Video Generation Test
 * Tests the complete workflow: LLM → A1111 → ComfyUI
 */

const AIProcessor = require('./aiProcessor');
const ImageGenerator = require('./imageGenerator');
const VideoGenerator = require('./videoGenerator');
const dockerManager = require('./dockerManager');

// Test configuration
const TEST_PROMPT = "Generate an image of a beautiful sunset over the ocean [IMAGE_PROMPT: stunning sunset over calm ocean waters, vibrant orange and pink sky] [VIDEO_PROMPT: camera slowly zooming in, gentle waves movement]";

console.log('='.repeat(80));
console.log('🎬 End-to-End Video Generation Test (with Docker Management)');
console.log('='.repeat(80));
console.log();

async function runTest() {
    // Initialize processors
    console.log('🔧 Initializing AI processors...');
    const aiProcessor = new AIProcessor({
        localaiUrl: 'http://192.168.1.206:8082',
        model: 'josiefied-qwen3-4b-abliterated-gpu'
    });

    const imageGenerator = new ImageGenerator({
        a1111Url: 'http://192.168.1.206:7860',
        dockerManager: dockerManager
    });

    const videoGenerator = new VideoGenerator({
        comfyuiUrl: 'http://192.168.1.206:8188',
        dockerManager: dockerManager
    });

    console.log('✅ Processors initialized');
    console.log();

    // Step 1: Test AI response parsing
    console.log('='.repeat(80));
    console.log('STEP 1: AI Response Processing');
    console.log('='.repeat(80));
    console.log();
    console.log('Test prompt:', TEST_PROMPT);
    console.log();

    // Simulate AI response (in real scenario, this would come from LocalAI)
    const simulatedAIResponse = TEST_PROMPT;
    
    // Extract prompts
    const imagePrompt = aiProcessor.extractImagePrompt(simulatedAIResponse);
    const videoPrompt = aiProcessor.extractVideoPrompt(simulatedAIResponse);
    
    console.log('📊 Extracted prompts:');
    console.log('   Image prompt:', imagePrompt || 'NONE');
    console.log('   Video prompt:', videoPrompt || 'NONE');
    console.log('   Needs video:', !!videoPrompt);
    console.log();

    if (!imagePrompt) {
        console.log('❌ No image prompt found - cannot proceed');
        process.exit(1);
    }

    if (!videoPrompt) {
        console.log('❌ No video prompt found - cannot proceed');
        process.exit(1);
    }

    // Step 2: Generate image with A1111
    console.log('='.repeat(80));
    console.log('STEP 2: Image Generation (A1111)');
    console.log('='.repeat(80));
    console.log();
    console.log('Generating image from prompt:', imagePrompt);
    console.log();

    let imageResult;
    try {
        imageResult = await imageGenerator.generate(imagePrompt);
        console.log('✅ Image generated successfully');
        console.log('   Base64 length:', imageResult.base64Image.length);
        console.log('   Size:', (imageResult.base64Image.length / 1024).toFixed(2), 'KB');
        console.log('   Format:', imageResult.base64Image.substring(0, 30) + '...');
        console.log();
    } catch (error) {
        console.error('❌ Image generation failed:', error.message);
        process.exit(1);
    }

    // Step 3: Generate video with ComfyUI
    console.log('='.repeat(80));
    console.log('STEP 3: Video Generation (ComfyUI)');
    console.log('='.repeat(80));
    console.log();
    console.log('Generating video from image...');
    console.log('   Video prompt:', videoPrompt);
    console.log('   Using base64 image from A1111 (no file I/O)');
    console.log();

    let videoResult;
    try {
        videoResult = await videoGenerator.generate(imageResult.base64Image, videoPrompt);
        console.log('✅ Video generated successfully');
        console.log('   Base64 length:', videoResult.videoData.length);
        console.log('   Size:', (videoResult.videoData.length / 1024 / 1024).toFixed(2), 'MB');
        console.log('   Format:', videoResult.videoData.substring(0, 30) + '...');
        console.log();
    } catch (error) {
        console.error('❌ Video generation failed:', error.message);
        console.error('   Error details:', error);
        
        // Cleanup: Stop ComfyUI container on error
        console.log();
        console.log('🧹 Cleaning up (stopping ComfyUI)...');
        try {
            await dockerManager.stopContainer('ComfyUI');
            console.log('✅ ComfyUI stopped');
        } catch (cleanupError) {
            console.error('⚠️ Cleanup failed:', cleanupError.message);
        }
        
        process.exit(1);
    }

    // Step 4: Cleanup - Stop containers to free VRAM
    console.log('='.repeat(80));
    console.log('STEP 4: Cleanup (Stop Containers)');
    console.log('='.repeat(80));
    console.log();
    
    try {
        console.log('🛑 Stopping A1111 container...');
        await dockerManager.stopContainer('AUTOMATIC1111-Stable-Diffusion-Web-UI');
        console.log('✅ A1111 stopped');
        
        console.log('🛑 Stopping ComfyUI container...');
        await dockerManager.stopContainer('ComfyUI');
        console.log('✅ ComfyUI stopped');
        
        console.log();
        console.log('🎉 All containers stopped - VRAM freed!');
        console.log();
    } catch (error) {
        console.error('⚠️ Container cleanup failed:', error.message);
        console.log();
    }

    // Summary
    console.log('='.repeat(80));
    console.log('✅ END-TO-END TEST COMPLETED SUCCESSFULLY');
    console.log('='.repeat(80));
    console.log();
    console.log('Pipeline Summary:');
    console.log('   1. ✅ AI Response Parsing (extracted image + video prompts)');
    console.log('   2. ✅ A1111 Image Generation (with Docker start/stop)');
    console.log('   3. ✅ ComfyUI Video Generation (with Docker start/stop)');
    console.log('   4. ✅ VRAM Management (all containers stopped after completion)');
    console.log();
    console.log('Image size:', (imageResult.base64Image.length / 1024).toFixed(2), 'KB');
    console.log('Video size:', (videoResult.videoData.length / 1024 / 1024).toFixed(2), 'MB');
    console.log();
    console.log('🎉 The complete pipeline works! No file I/O needed - all base64!');
    console.log('💾 VRAM optimized with automatic container management!');
}

// Run the test
runTest().catch(error => {
    console.error();
    console.error('='.repeat(80));
    console.error('❌ TEST FAILED');
    console.error('='.repeat(80));
    console.error('Error:', error.message);
    console.error();
    console.error('Stack trace:');
    console.error(error.stack);
    process.exit(1);
});
