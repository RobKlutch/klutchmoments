#!/bin/bash
# Complete GPU deployment script with optimization

set -e  # Exit on any error

# Configuration
RESOURCE_GROUP="klutch-gpu-mvp"
LOCATION="eastus"
REGISTRY_NAME="klutchgpuregistry"
IMAGE_NAME="klutch-gpu-api"
CONTAINER_NAME="klutch-gpu-mvp"
TAG="v$(date +%Y%m%d-%H%M%S)"

echo "🚀 Klutch GPU MVP Deployment Started"
echo "==================================="
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo "Registry: $REGISTRY_NAME"
echo "Image: $IMAGE_NAME:$TAG"
echo ""

# Step 1: Create resource group
echo "📦 Step 1: Creating resource group..."
az group create --name $RESOURCE_GROUP --location $LOCATION
echo "✅ Resource group created"

# Step 2: Create Azure Container Registry
echo "🏗️ Step 2: Creating container registry..."
az acr create --resource-group $RESOURCE_GROUP \
  --name $REGISTRY_NAME --sku Basic --admin-enabled true
echo "✅ Container registry created"

# Get registry credentials
ACR_SERVER=$(az acr show --name $REGISTRY_NAME --query loginServer --output tsv)
ACR_USERNAME=$(az acr credential show --name $REGISTRY_NAME --query username --output tsv)
ACR_PASSWORD=$(az acr credential show --name $REGISTRY_NAME --query passwords[0].value --output tsv)

echo "🔑 Registry: $ACR_SERVER"
echo "🔑 Username: $ACR_USERNAME"

# Step 3: Build and push optimized image
echo "🔨 Step 3: Building GPU-optimized Docker image..."
echo "This may take 5-10 minutes for the first build..."

az acr build --registry $REGISTRY_NAME \
  --image $IMAGE_NAME:$TAG \
  --image $IMAGE_NAME:latest \
  --file Dockerfile.gpu-optimized .

echo "✅ Image built and pushed: $ACR_SERVER/$IMAGE_NAME:$TAG"

# Step 4: Deploy to Azure Container Instances with GPU
echo "🎯 Step 4: Deploying to Azure Container Instances with GPU..."
echo "Requesting GPU resources (this may take a few minutes)..."

az container create \
  --resource-group $RESOURCE_GROUP \
  --name $CONTAINER_NAME \
  --image $ACR_SERVER/$IMAGE_NAME:$TAG \
  --registry-login-server $ACR_SERVER \
  --registry-username $ACR_USERNAME \
  --registry-password $ACR_PASSWORD \
  --cpu 4 \
  --memory 16 \
  --gpu-count 1 \
  --gpu-sku V100 \
  --ports 8000 \
  --dns-name-label klutch-gpu-mvp \
  --location $LOCATION \
  --restart-policy Always \
  --environment-variables \
    NODE_ENV=production \
    API_ONLY=true \
    ENABLE_GPU=true \
    YOLO_MODEL_PATH=/app/yolo11n.onnx

# Step 5: Get deployment information
echo "📍 Step 5: Getting deployment information..."

PUBLIC_IP=$(az container show --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME --query ipAddress.ip --output tsv)
FQDN=$(az container show --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME --query ipAddress.fqdn --output tsv)

echo ""
echo "🎉 DEPLOYMENT SUCCESSFUL!"
echo "========================="
echo "🌐 API URL: http://$FQDN:8000"
echo "📍 Public IP: $PUBLIC_IP"
echo "🏥 Health Check: http://$FQDN:8000/health"
echo "🔬 Performance Test: POST http://$FQDN:8000/api/performance-test"
echo "💪 Stress Test: POST http://$FQDN:8000/api/stress-test"
echo "📊 GPU Status: GET http://$FQDN:8000/api/gpu-status"
echo ""

# Step 6: Wait for container to be ready and test
echo "⏳ Step 6: Waiting for container to be ready..."
sleep 60

echo "🧪 Testing deployment..."
if curl -s --max-time 10 http://$FQDN:8000/health > /dev/null; then
    echo "✅ Health check passed!"
    
    # Get detailed health info
    echo "📊 System Status:"
    curl -s http://$FQDN:8000/health | python3 -m json.tool
    
    echo ""
    echo "🎯 Ready for GPU testing!"
    echo ""
    echo "Next steps:"
    echo "1. Run performance tests: node test-gpu-comprehensive.js http://$FQDN:8000"
    echo "2. Monitor GPU usage: curl http://$FQDN:8000/api/gpu-status"
    echo "3. Run stress tests for load validation"
    
else
    echo "⚠️ Health check failed. Container may still be starting..."
    echo "Check logs with: az container logs --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME"
fi

echo ""
echo "💰 Cost monitoring:"
echo "V100 GPU: ~\$3.00/hour"
echo "Remember to stop the container when not testing!"
echo ""
echo "🛑 To stop: az container stop --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME"
echo "🗑️ To cleanup: az group delete --name $RESOURCE_GROUP"