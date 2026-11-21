
variable "aws_region" {
  default = "ap-south-1"
}

variable "environment" {
  default = "production"
}

variable "cluster_endpoint_public_access_cidrs" {
  description = "CIDR ranges allowed to access the public EKS API endpoint"
  type        = list(string)
}
