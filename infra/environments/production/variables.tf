variable "db_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}

variable "aws_region" {
  default = "ap-south-1"
}

variable "environment" {
  default = "production"
}

variable "bastion_key_name" {
  description = "EC2 key pair name for bastion SSH access"
  type        = string
}
