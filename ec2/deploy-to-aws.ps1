# 🚀 AWS Migration Deployment Script
# Run this script to deploy your sensor app infrastructure to AWS

param(
    [string]$AWSRegion = "us-east-1",
    [string]$Environment = "production",
    [string]$ProjectName = "sensor-app",
    [switch]$SkipTerraform = $false,
    [switch]$DeployLambdas = $true,
    [switch]$SetupAPIGateway = $true
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting AWS Migration Deployment" -ForegroundColor Green
Write-Host "Region: $AWSRegion" -ForegroundColor Yellow
Write-Host "Environment: $Environment" -ForegroundColor Yellow
Write-Host "Project: $ProjectName" -ForegroundColor Yellow

# Check prerequisites
Write-Host "`n📋 Checking prerequisites..." -ForegroundColor Blue

# Check if AWS CLI is installed
try {
    aws --version | Out-Null
    Write-Host "✅ AWS CLI is installed" -ForegroundColor Green
} catch {
    Write-Host "❌ AWS CLI is not installed. Please install it first." -ForegroundColor Red
    exit 1
}

# Check if Terraform is installed (if not skipping)
if (-not $SkipTerraform) {
    try {
        terraform version | Out-Null
        Write-Host "✅ Terraform is installed" -ForegroundColor Green
    } catch {
        Write-Host "❌ Terraform is not installed. Please install it first." -ForegroundColor Red
        exit 1
    }
}

# Check AWS credentials
try {
    aws sts get-caller-identity | Out-Null
    Write-Host "✅ AWS credentials are configured" -ForegroundColor Green
} catch {
    Write-Host "❌ AWS credentials not configured. Run 'aws configure' first." -ForegroundColor Red
    exit 1
}

# Create necessary directories
Write-Host "`n📁 Creating deployment directories..." -ForegroundColor Blue
$deploymentDir = "aws-deployment"
if (-not (Test-Path $deploymentDir)) {
    New-Item -ItemType Directory -Path $deploymentDir | Out-Null
}

$lambdaDir = "$deploymentDir\lambda-functions"
if (-not (Test-Path $lambdaDir)) {
    New-Item -ItemType Directory -Path $lambdaDir | Out-Null
}

# Generate terraform.tfvars file
Write-Host "`n⚙️ Generating Terraform variables..." -ForegroundColor Blue
$dbPassword = -join ((1..16) | ForEach-Object { Get-Random -InputObject ([char[]]"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") })

@"
aws_region   = "$AWSRegion"
environment  = "$Environment"
project_name = "$ProjectName"
db_password  = "$dbPassword"
"@ | Out-File -FilePath "terraform.tfvars" -Encoding UTF8

Write-Host "✅ Generated terraform.tfvars" -ForegroundColor Green

# Deploy infrastructure with Terraform
if (-not $SkipTerraform) {
    Write-Host "`n🏗️ Deploying infrastructure with Terraform..." -ForegroundColor Blue
    
    try {
        terraform init
        terraform plan -out=tfplan
        Write-Host "Review the Terraform plan above. Press Enter to continue or Ctrl+C to abort..." -ForegroundColor Yellow
        Read-Host
        terraform apply tfplan
        Write-Host "✅ Infrastructure deployed successfully" -ForegroundColor Green
    } catch {
        Write-Host "❌ Terraform deployment failed: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# Get Terraform outputs
Write-Host "`n📊 Getting infrastructure details..." -ForegroundColor Blue
try {
    $terraformOutput = terraform output -json | ConvertFrom-Json
    $dynamoTables = $terraformOutput.dynamodb_tables.value
    $rdsEndpoint = $terraformOutput.rds_endpoint.value
    $cognitoUserPoolId = $terraformOutput.cognito_user_pool_id.value
    $cognitoClientId = $terraformOutput.cognito_user_pool_client_id.value
    $snsTopicArn = $terraformOutput.sns_topic_arn.value
    $s3BucketName = $terraformOutput.s3_bucket_name.value
    
    Write-Host "✅ Retrieved infrastructure details" -ForegroundColor Green
} catch {
    Write-Host "⚠️ Could not retrieve Terraform outputs. Using defaults..." -ForegroundColor Yellow
    $dynamoTables = @{
        sensors = "$ProjectName-sensors"
        alerts = "$ProjectName-alerts"
        users = "$ProjectName-users"
        devices = "$ProjectName-devices"
    }
}

# Prepare Lambda function packages
if ($DeployLambdas) {
    Write-Host "`n📦 Preparing Lambda function packages..." -ForegroundColor Blue
    
    $lambdaFunctions = @(
        @{ name = "receive-ml-alert"; file = "lambda-receive-ml-alert.js" },
        @{ name = "device-management"; file = "lambda-device-management.js" },
        @{ name = "sensor-data"; file = "lambda-sensor-data.js" }
    )
    
    foreach ($func in $lambdaFunctions) {
        $functionDir = "$lambdaDir\$($func.name)"
        if (-not (Test-Path $functionDir)) {
            New-Item -ItemType Directory -Path $functionDir | Out-Null
        }
        
        # Copy Lambda function code
        Copy-Item $func.file -Destination "$functionDir\index.js"
        
        # Create package.json
        @"
{
  "name": "$($func.name)",
  "version": "1.0.0",
  "description": "AWS Lambda function for $($func.name)",
  "main": "index.js",
  "dependencies": {
    "aws-sdk": "^2.1300.0",
    "uuid": "^9.0.0"
  }
}
"@ | Out-File -FilePath "$functionDir\package.json" -Encoding UTF8
        
        # Install dependencies and create deployment package
        Write-Host "Installing dependencies for $($func.name)..." -ForegroundColor Cyan
        Push-Location $functionDir
        try {
            npm install --production
            
            # Create ZIP package
            $zipFile = "..\$($func.name).zip"
            if (Test-Path $zipFile) { Remove-Item $zipFile }
            Compress-Archive -Path ".\*" -DestinationPath $zipFile
            Write-Host "✅ Created package: $zipFile" -ForegroundColor Green
        } finally {
            Pop-Location
        }
    }
    
    # Deploy Lambda functions
    Write-Host "`n🚀 Deploying Lambda functions..." -ForegroundColor Blue
    
    foreach ($func in $lambdaFunctions) {
        $functionName = "$ProjectName-$($func.name)"
        $zipFile = "$lambdaDir\$($func.name).zip"
        
        try {
            # Check if function exists
            $functionExists = $true
            try {
                aws lambda get-function --function-name $functionName --region $AWSRegion | Out-Null
            } catch {
                $functionExists = $false
            }
            
            if ($functionExists) {
                Write-Host "Updating function: $functionName" -ForegroundColor Cyan
                aws lambda update-function-code --function-name $functionName --zip-file "fileb://$zipFile" --region $AWSRegion | Out-Null
            } else {
                Write-Host "Creating function: $functionName" -ForegroundColor Cyan
                # Get IAM role ARN (you might need to adjust this)
                $roleArn = "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/$ProjectName-lambda-execution"
                
                aws lambda create-function `
                    --function-name $functionName `
                    --runtime "nodejs18.x" `
                    --role $roleArn `
                    --handler "index.handler" `
                    --zip-file "fileb://$zipFile" `
                    --timeout 30 `
                    --memory-size 256 `
                    --environment "Variables={ALERTS_TABLE=$($dynamoTables.alerts),DEVICES_TABLE=$($dynamoTables.devices),SENSORS_TABLE=$($dynamoTables.sensors),USERS_TABLE=$($dynamoTables.users),SNS_TOPIC_ARN=$snsTopicArn}" `
                    --region $AWSRegion | Out-Null
            }
            
            Write-Host "✅ Deployed: $functionName" -ForegroundColor Green
        } catch {
            Write-Host "❌ Failed to deploy $functionName : $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

# Create API Gateway configuration
if ($SetupAPIGateway) {
    Write-Host "`n🌐 Setting up API Gateway..." -ForegroundColor Blue
    
    $apiGatewayConfig = @"
{
  "openapi": "3.0.1",
  "info": {
    "title": "$ProjectName API",
    "description": "Sensor App API Gateway",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "https://{restApiId}.execute-api.$AWSRegion.amazonaws.com/prod"
    }
  ],
  "paths": {
    "/api/alerts": {
      "post": {
        "x-amazon-apigateway-integration": {
          "uri": "arn:aws:apigateway:$AWSRegion:lambda:path/2015-03-31/functions/arn:aws:lambda:$AWSRegion:{accountId}:function:$ProjectName-receive-ml-alert/invocations",
          "httpMethod": "POST",
          "type": "aws_proxy"
        }
      }
    },
    "/api/devices": {
      "get": {
        "x-amazon-apigateway-integration": {
          "uri": "arn:aws:apigateway:$AWSRegion:lambda:path/2015-03-31/functions/arn:aws:lambda:$AWSRegion:{accountId}:function:$ProjectName-device-management/invocations",
          "httpMethod": "POST",
          "type": "aws_proxy"
        }
      },
      "post": {
        "x-amazon-apigateway-integration": {
          "uri": "arn:aws:apigateway:$AWSRegion:lambda:path/2015-03-31/functions/arn:aws:lambda:$AWSRegion:{accountId}:function:$ProjectName-device-management/invocations",
          "httpMethod": "POST",
          "type": "aws_proxy"
        }
      }
    },
    "/api/sensor-data": {
      "post": {
        "x-amazon-apigateway-integration": {
          "uri": "arn:aws:apigateway:$AWSRegion:lambda:path/2015-03-31/functions/arn:aws:lambda:$AWSRegion:{accountId}:function:$ProjectName-sensor-data/invocations",
          "httpMethod": "POST",
          "type": "aws_proxy"
        }
      }
    }
  }
}
"@
    
    $apiGatewayConfig | Out-File -FilePath "$deploymentDir\api-gateway-config.json" -Encoding UTF8
    Write-Host "✅ Generated API Gateway configuration" -ForegroundColor Green
}

# Generate environment configuration file
Write-Host "`n📝 Generating environment configuration..." -ForegroundColor Blue

$envConfig = @"
# AWS Environment Configuration
# Generated on $(Get-Date)

# AWS Region
AWS_REGION=$AWSRegion

# DynamoDB Tables
ALERTS_TABLE=$($dynamoTables.alerts)
DEVICES_TABLE=$($dynamoTables.devices)
SENSORS_TABLE=$($dynamoTables.sensors)
USERS_TABLE=$($dynamoTables.users)

# RDS Database
DATABASE_URL=postgresql://postgres:$dbPassword@$($rdsEndpoint -replace ':5432', '')/sensor_app

# Cognito
COGNITO_USER_POOL_ID=$cognitoUserPoolId
COGNITO_USER_POOL_CLIENT_ID=$cognitoClientId

# SNS
SNS_TOPIC_ARN=$snsTopicArn

# S3
S3_BUCKET_NAME=$s3BucketName

# API Gateway
API_GATEWAY_URL=https://YOUR_API_ID.execute-api.$AWSRegion.amazonaws.com/prod
"@

$envConfig | Out-File -FilePath "$deploymentDir\.env" -Encoding UTF8
$envConfig | Out-File -FilePath "aws-environment-config.env" -Encoding UTF8

Write-Host "`n🎉 AWS Migration Deployment Complete!" -ForegroundColor Green
Write-Host "`n📋 Next Steps:" -ForegroundColor Blue
Write-Host "1. ✅ Review the generated environment config: aws-environment-config.env" -ForegroundColor Yellow
Write-Host "2. 🌐 Complete API Gateway setup (if needed)" -ForegroundColor Yellow  
Write-Host "3. 📱 Update mobile app configuration with new AWS endpoints" -ForegroundColor Yellow
Write-Host "4. 🔧 Configure monitoring and logging in CloudWatch" -ForegroundColor Yellow
Write-Host "5. 🧪 Run tests against the new AWS infrastructure" -ForegroundColor Yellow
Write-Host "6. 🚀 Go live with the new AWS setup" -ForegroundColor Yellow

Write-Host "`n💰 Estimated monthly cost: $67-155" -ForegroundColor Green
Write-Host "`n📊 View your AWS resources at: https://console.aws.amazon.com" -ForegroundColor Cyan