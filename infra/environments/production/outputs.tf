output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "ecr_repositories" {
  value = { for k, v in aws_ecr_repository.services : k => v.repository_url }
}

output "rds_endpoint" {
  value     = aws_db_instance.main.endpoint
  sensitive = true
}

output "redis_endpoint" {
  value     = aws_elasticache_replication_group.main.primary_endpoint_address
  sensitive = true
}

output "sqs_orders_url" {
  value = aws_sqs_queue.orders.url
}

output "assets_bucket" {
  value = aws_s3_bucket.assets.id
}

output "github_actions_role_arn" {
  value = aws_iam_role.github_actions.arn
}

output "api_role_arn" {
  value = module.api_irsa.iam_role_arn
}

output "worker_role_arn" {
  value = module.worker_irsa.iam_role_arn
}

output "bastion_public_ip" {
  value = aws_instance.bastion.public_ip
}
