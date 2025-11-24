// API-only server configuration for GPU testing
const express = require('express');
const cors = require('cors');
const { realYolov8DetectionService } = require('./services/realYolov8Detection');

const app = express();
const PORT = process.env.PORT || 8000;

// Enable CORS for testing from any origin
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    mode: 'api-only',
    gpu: process.env.ENABLE_GPU === 'true',
    timestamp: new Date().toISOString()
  });
});

// Initialize YOLO detection service
realYolov8DetectionService.initialize()
  .then(() => {
    console.log('🎯 YOLO detection service ready for GPU testing');
  })
  .catch(err => {
    console.error('❌ Failed to initialize YOLO service:', err);
  });

// Detection API endpoint
app.post('/api/detect-players', async (req, res) => {
  try {
    const { imageDataUrl, timestampMs, selectedPlayerId } = req.body;
    
    console.log(`🎯 GPU Detection Request: ${timestampMs}ms, player: ${selectedPlayerId}`);
    const startTime = Date.now();
    
    const result = await realYolov8DetectionService.detectPlayers(imageDataUrl, timestampMs);
    const processingTime = Date.now() - startTime;
    
    console.log(`✅ GPU Detection Complete: ${processingTime}ms, found ${result.players?.length || 0} players`);
    
    res.json({
      ...result,
      gpuProcessingTime: processingTime,
      apiMode: 'gpu-testing'
    });
  } catch (error) {
    console.error('❌ GPU Detection Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      apiMode: 'gpu-testing'
    });
  }
});

// Performance testing endpoint
app.post('/api/performance-test', async (req, res) => {
  try {
    const { imageDataUrl, iterations = 10 } = req.body;
    const results = [];
    
    console.log(`🚀 Starting GPU performance test: ${iterations} iterations`);
    
    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now();
      const result = await realYolov8DetectionService.detectPlayers(imageDataUrl, i * 1000);
      const processingTime = Date.now() - startTime;
      
      results.push({
        iteration: i + 1,
        processingTime,
        playersDetected: result.players?.length || 0,
        modelType: result.modelType
      });
      
      console.log(`📊 Iteration ${i + 1}/${iterations}: ${processingTime}ms, ${result.players?.length || 0} players`);
    }
    
    const avgTime = results.reduce((sum, r) => sum + r.processingTime, 0) / results.length;
    const minTime = Math.min(...results.map(r => r.processingTime));
    const maxTime = Math.max(...results.map(r => r.processingTime));
    
    res.json({
      success: true,
      summary: {
        iterations,
        averageTime: avgTime,
        minTime,
        maxTime,
        throughput: 1000 / avgTime // frames per second
      },
      results,
      gpuEnabled: process.env.ENABLE_GPU === 'true'
    });
  } catch (error) {
    console.error('❌ Performance test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Klutch GPU API Server running on port ${PORT}`);
  console.log(`🎯 GPU Mode: ${process.env.ENABLE_GPU === 'true' ? 'ENABLED' : 'CPU ONLY'}`);
  console.log(`📍 Health Check: http://localhost:${PORT}/health`);
  console.log(`🔬 Performance Test: POST /api/performance-test`);
});

module.exports = app;