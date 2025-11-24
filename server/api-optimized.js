// GPU-Optimized API server with enhanced performance monitoring
const express = require('express');
const cors = require('cors');
const os = require('os');
const { performance } = require('perf_hooks');

const app = express();
const PORT = process.env.PORT || 8000;

// Enhanced middleware
app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Performance monitoring middleware
app.use((req, res, next) => {
    req.startTime = performance.now();
    res.on('finish', () => {
        const duration = performance.now() - req.startTime;
        console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration.toFixed(2)}ms`);
    });
    next();
});

// GPU status monitoring
let gpuInfo = null;
let detectionService = null;

async function initializeGPUService() {
    try {
        console.log('🔄 Initializing GPU detection service...');
        
        // Dynamic import to handle missing modules gracefully
        const { realYolov8DetectionService } = require('./services/realYolov8Detection');
        detectionService = realYolov8DetectionService;
        
        await detectionService.initialize();
        console.log('✅ GPU detection service initialized');
        
        // Get GPU info if available
        try {
            const { execSync } = require('child_process');
            const gpuOutput = execSync('nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits', { encoding: 'utf8' });
            const [name, total, used] = gpuOutput.trim().split(', ');
            gpuInfo = {
                name: name.trim(),
                memoryTotal: parseInt(total),
                memoryUsed: parseInt(used),
                memoryAvailable: parseInt(total) - parseInt(used)
            };
            console.log(`🎯 GPU Ready: ${gpuInfo.name} (${gpuInfo.memoryAvailable}MB available)`);
        } catch (e) {
            console.log('⚠️ GPU info not available, using CPU mode');
        }
        
        return true;
    } catch (error) {
        console.error('❌ GPU service initialization failed:', error);
        return false;
    }
}

// Enhanced health check with GPU metrics
app.get('/health', (req, res) => {
    const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        mode: 'gpu-optimized',
        system: {
            platform: os.platform(),
            arch: os.arch(),
            cpus: os.cpus().length,
            memory: {
                total: Math.round(os.totalmem() / 1024 / 1024),
                free: Math.round(os.freemem() / 1024 / 1024),
                used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024)
            },
            uptime: Math.round(os.uptime())
        },
        gpu: gpuInfo || { available: false },
        service: {
            initialized: detectionService !== null,
            modelType: process.env.YOLO_MODEL_PATH ? 'YOLO11n-ONNX' : 'HOG-Fallback'
        }
    };
    
    res.json(healthData);
});

// Enhanced detection endpoint with performance metrics
app.post('/api/detect-players', async (req, res) => {
    const requestStart = performance.now();
    
    try {
        const { imageDataUrl, timestampMs, selectedPlayerId } = req.body;
        
        if (!detectionService) {
            throw new Error('Detection service not initialized');
        }
        
        console.log(`🎯 GPU Detection Request: ${timestampMs}ms, player: ${selectedPlayerId || 'none'}`);
        
        const detectionStart = performance.now();
        const result = await detectionService.detectPlayers(imageDataUrl, timestampMs || 0);
        const detectionTime = performance.now() - detectionStart;
        
        const totalTime = performance.now() - requestStart;
        
        console.log(`✅ GPU Detection Complete: ${detectionTime.toFixed(2)}ms detection, ${totalTime.toFixed(2)}ms total, found ${result.players?.length || 0} players`);
        
        res.json({
            ...result,
            performance: {
                detectionTime: Math.round(detectionTime),
                totalTime: Math.round(totalTime),
                overhead: Math.round(totalTime - detectionTime)
            },
            gpu: gpuInfo,
            apiMode: 'gpu-optimized'
        });
        
    } catch (error) {
        const errorTime = performance.now() - requestStart;
        console.error(`❌ GPU Detection Error (${errorTime.toFixed(2)}ms):`, error);
        
        res.status(500).json({
            success: false,
            error: error.message,
            performance: {
                errorTime: Math.round(errorTime)
            },
            apiMode: 'gpu-optimized'
        });
    }
});

// Comprehensive performance testing endpoint
app.post('/api/performance-test', async (req, res) => {
    try {
        const { 
            imageDataUrl, 
            iterations = 10, 
            warmupRuns = 3,
            concurrent = false,
            includeMemoryProfile = true
        } = req.body;
        
        if (!detectionService) {
            throw new Error('Detection service not initialized');
        }
        
        console.log(`🚀 Starting GPU performance test: ${iterations} iterations, warmup: ${warmupRuns}, concurrent: ${concurrent}`);
        
        const results = {
            testConfig: { iterations, warmupRuns, concurrent, includeMemoryProfile },
            warmup: [],
            performance: [],
            summary: {},
            gpu: gpuInfo,
            timestamp: new Date().toISOString()
        };
        
        // Warmup runs
        console.log(`🔥 Warmup phase: ${warmupRuns} runs...`);
        for (let i = 0; i < warmupRuns; i++) {
            const start = performance.now();
            await detectionService.detectPlayers(imageDataUrl, i * 100);
            const time = performance.now() - start;
            results.warmup.push(Math.round(time));
            console.log(`🔥 Warmup ${i + 1}/${warmupRuns}: ${time.toFixed(2)}ms`);
        }
        
        // Performance testing
        console.log(`📊 Performance phase: ${iterations} runs...`);
        
        if (concurrent) {
            // Concurrent testing
            const promises = [];
            for (let i = 0; i < iterations; i++) {
                promises.push((async () => {
                    const start = performance.now();
                    const result = await detectionService.detectPlayers(imageDataUrl, i * 1000);
                    const time = performance.now() - start;
                    return {
                        iteration: i + 1,
                        processingTime: Math.round(time),
                        playersDetected: result.players?.length || 0,
                        modelType: result.modelType
                    };
                })());
            }
            
            results.performance = await Promise.all(promises);
        } else {
            // Sequential testing
            for (let i = 0; i < iterations; i++) {
                const start = performance.now();
                const result = await detectionService.detectPlayers(imageDataUrl, i * 1000);
                const time = performance.now() - start;
                
                results.performance.push({
                    iteration: i + 1,
                    processingTime: Math.round(time),
                    playersDetected: result.players?.length || 0,
                    modelType: result.modelType
                });
                
                console.log(`📊 Run ${i + 1}/${iterations}: ${time.toFixed(2)}ms, ${result.players?.length || 0} players`);
            }
        }
        
        // Calculate summary statistics
        const times = results.performance.map(r => r.processingTime);
        const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const medianTime = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
        const throughput = 1000 / avgTime;
        
        results.summary = {
            averageTime: Math.round(avgTime),
            medianTime: Math.round(medianTime),
            minTime,
            maxTime,
            stdDeviation: Math.round(Math.sqrt(times.reduce((sum, t) => sum + Math.pow(t - avgTime, 2), 0) / times.length)),
            throughput: Math.round(throughput * 100) / 100,
            totalPlayers: results.performance.reduce((sum, r) => sum + r.playersDetected, 0),
            consistency: Math.round((1 - (maxTime - minTime) / avgTime) * 100)
        };
        
        console.log(`📊 Performance Summary:`);
        console.log(`   Average: ${results.summary.averageTime}ms`);
        console.log(`   Median: ${results.summary.medianTime}ms`);
        console.log(`   Range: ${minTime}-${maxTime}ms`);
        console.log(`   Throughput: ${results.summary.throughput} FPS`);
        console.log(`   Consistency: ${results.summary.consistency}%`);
        
        res.json({
            success: true,
            ...results
        });
        
    } catch (error) {
        console.error('❌ Performance test error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            apiMode: 'gpu-optimized'
        });
    }
});

// Stress testing endpoint
app.post('/api/stress-test', async (req, res) => {
    try {
        const { duration = 60, requestsPerSecond = 5, imageDataUrl } = req.body;
        
        console.log(`💪 Starting stress test: ${duration}s at ${requestsPerSecond} RPS`);
        
        const results = {
            config: { duration, requestsPerSecond },
            requests: [],
            errors: [],
            startTime: Date.now()
        };
        
        const interval = 1000 / requestsPerSecond;
        let requestCount = 0;
        
        const stressInterval = setInterval(async () => {
            if (Date.now() - results.startTime > duration * 1000) {
                clearInterval(stressInterval);
                
                // Calculate stress test summary
                const successfulRequests = results.requests.filter(r => r.success);
                const avgResponseTime = successfulRequests.reduce((sum, r) => sum + r.responseTime, 0) / successfulRequests.length;
                
                const summary = {
                    totalRequests: results.requests.length,
                    successfulRequests: successfulRequests.length,
                    failedRequests: results.errors.length,
                    successRate: Math.round((successfulRequests.length / results.requests.length) * 100),
                    averageResponseTime: Math.round(avgResponseTime),
                    actualRPS: Math.round(results.requests.length / duration)
                };
                
                console.log(`💪 Stress test complete:`, summary);
                
                return res.json({
                    success: true,
                    summary,
                    results
                });
            }
            
            // Make concurrent request
            (async () => {
                const requestId = ++requestCount;
                const start = performance.now();
                
                try {
                    await detectionService.detectPlayers(imageDataUrl, requestId * 1000);
                    results.requests.push({
                        id: requestId,
                        success: true,
                        responseTime: Math.round(performance.now() - start),
                        timestamp: Date.now()
                    });
                } catch (error) {
                    results.errors.push({
                        id: requestId,
                        error: error.message,
                        responseTime: Math.round(performance.now() - start),
                        timestamp: Date.now()
                    });
                }
            })();
        }, interval);
        
    } catch (error) {
        console.error('❌ Stress test error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GPU memory monitoring endpoint
app.get('/api/gpu-status', (req, res) => {
    try {
        if (gpuInfo) {
            // Update GPU memory usage
            const { execSync } = require('child_process');
            const gpuOutput = execSync('nvidia-smi --query-gpu=memory.used,temperature.gpu,utilization.gpu --format=csv,noheader,nounits', { encoding: 'utf8' });
            const [memoryUsed, temperature, utilization] = gpuOutput.trim().split(', ');
            
            res.json({
                gpu: {
                    ...gpuInfo,
                    memoryUsed: parseInt(memoryUsed),
                    memoryAvailable: gpuInfo.memoryTotal - parseInt(memoryUsed),
                    temperature: parseInt(temperature),
                    utilization: parseInt(utilization)
                },
                timestamp: new Date().toISOString()
            });
        } else {
            res.json({
                gpu: { available: false },
                message: 'GPU not available'
            });
        }
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get GPU status',
            details: error.message
        });
    }
});

// Initialize and start server
async function startServer() {
    console.log('🚀 Initializing Klutch GPU-Optimized API...');
    
    await initializeGPUService();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🎯 Klutch GPU API Server running on port ${PORT}`);
        console.log(`🔥 GPU Mode: ${gpuInfo ? 'ENABLED' : 'CPU FALLBACK'}`);
        console.log(`📍 Health Check: http://localhost:${PORT}/health`);
        console.log(`🔬 Performance Test: POST /api/performance-test`);
        console.log(`💪 Stress Test: POST /api/stress-test`);
        console.log(`📊 GPU Status: GET /api/gpu-status`);
    });
}

startServer().catch(console.error);