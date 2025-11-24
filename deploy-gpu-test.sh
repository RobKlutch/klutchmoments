#!/bin/bash
# GPU API Deployment Script for Azure

# Configuration
RESOURCE_GROUP="klutch-gpu-test"
LOCATION="eastus"
REGISTRY_NAME="klutchgpu"
IMAGE_NAME="klutch-api"
CONTAINER_NAME="klutch-gpu-api"

echo "🚀 Starting Klutch GPU API Deployment..."

# Create resource group
echo "📦 Creating resource group..."
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create Azure Container Registry
echo "🏗️ Creating container registry..."
az acr create --resource-group $RESOURCE_GROUP \
  --name $REGISTRY_NAME --sku Basic --admin-enabled true

# Get ACR credentials
ACR_SERVER=$(az acr show --name $REGISTRY_NAME --query loginServer --output tsv)
ACR_USERNAME=$(az acr credential show --name $REGISTRY_NAME --query username --output tsv)
ACR_PASSWORD=$(az acr credential show --name $REGISTRY_NAME --query passwords[0].value --output tsv)

echo "🔑 Registry: $ACR_SERVER"

# Build and push the GPU API image
echo "🔨 Building and pushing Docker image..."
az acr build --registry $REGISTRY_NAME \
  --image $IMAGE_NAME:gpu-test \
  --file Dockerfile.api .

# Deploy to Azure Container Instances with GPU
echo "🎯 Deploying to Azure Container Instances with GPU..."
az container create \
  --resource-group $RESOURCE_GROUP \
  --name $CONTAINER_NAME \
  --image $ACR_SERVER/$IMAGE_NAME:gpu-test \
  --registry-login-server $ACR_SERVER \
  --registry-username $ACR_USERNAME \
  --registry-password $ACR_PASSWORD \
  --cpu 2 \
  --memory 8 \
  --gpu-count 1 \
  --gpu-sku K80 \
  --ports 8000 \
  --dns-name-label klutch-gpu-test \
  --location $LOCATION \
  --environment-variables \
    NODE_ENV=production \
    API_ONLY=true \
    ENABLE_GPU=true

# Get the public IP
PUBLIC_IP=$(az container show --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME --query ipAddress.ip --output tsv)
FQDN=$(az container show --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME --query ipAddress.fqdn --output tsv)

echo "✅ Deployment Complete!"
echo "🌐 API URL: http://$FQDN:8000"
echo "📍 Health Check: http://$FQDN:8000/health"
echo "🔬 Performance Test: POST http://$FQDN:8000/api/performance-test"

# Test the deployment
echo "🧪 Testing deployment..."
sleep 30
curl -s http://$FQDN:8000/health | jq .

echo "🎉 GPU API Ready for Testing!"
echo ""
echo "Test Commands:"
echo "curl http://$FQDN:8000/health"
echo "curl -X POST http://$FQDN:8000/api/performance-test -H 'Content-Type: application/json' -d '{\"iterations\": 5}'"