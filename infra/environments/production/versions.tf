terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.0"
    }
  }

  backend "s3" {
    bucket         = "shopwave-tf-state-967283278916"
    key            = "production/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "shopwave-tf-lock"
    encrypt        = true
  }
}
