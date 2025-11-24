#!/bin/bash
# Quick deployment script for Azure Cloud Shell

echo "🚀 Klutch GPU Quick Deploy"
echo "========================="

# Check if we're in Azure Cloud Shell
if [ -z "$AZURE_HTTP_USER_AGENT" ]; then
    echo "⚠️  This script is designed for Azure Cloud Shell"
    echo "   Please run from: https://shell.azure.com"
    read -p "Continue anyway? (y/N): " continue
    if [[ ! $continue =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check Azure CLI
echo "🔍 Checking Azure CLI..."
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI not found"
    exit 1
fi

# Login check
echo "🔑 Checking Azure authentication..."
if ! az account show &> /dev/null; then
    echo "🔐 Please login to Azure..."
    az login
fi

# Show current subscription
SUBSCRIPTION=$(az account show --query name --output tsv)
echo "✅ Authenticated to: $SUBSCRIPTION"

# Extract package if not already done
if [ ! -d "server" ]; then
    if [ -f "klutch-gpu-deployment.tar.gz" ]; then
        echo "📦 Extracting deployment package..."
        tar -xzf klutch-gpu-deployment.tar.gz
    else
        echo "❌ Deployment package not found!"
        echo "   Please upload klutch-gpu-deployment.tar.gz first"
        exit 1
    fi
fi

# Make scripts executable
chmod +x deploy-gpu-complete.sh
chmod +x gpu-startup.sh

echo ""
echo "🎯 Ready to deploy Klutch GPU MVP!"
echo ""
echo "This will:"
echo "  ✅ Create Azure Container Registry"
echo "  ✅ Build GPU-optimized Docker image"
echo "  ✅ Deploy to V100 GPU container"
echo "  ✅ Run performance tests"
echo ""
echo "💰 Estimated cost: ~$3.50/hour"
echo "⏱️  Deployment time: 8-12 minutes"
echo ""

read -p "🚀 Start deployment? (y/N): " deploy
if [[ $deploy =~ ^[Yy]$ ]]; then
    echo ""
    echo "🚀 Starting deployment..."
    ./deploy-gpu-complete.sh
else
    echo "Deployment cancelled. Run './deploy-gpu-complete.sh' when ready."
fi