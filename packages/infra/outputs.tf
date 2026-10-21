# What the pipelines and people read after an apply: ids and names, never a secret's value.

output "nameservers" {
  description = "The Cloudflare nameservers of each zone; the registrar workflow points the domains at them."
  value = {
    "meltemi.dev"  = cloudflare_zone.dev.name_servers
    "meltemi.page" = cloudflare_zone.page.name_servers
  }
}

output "zone_status" {
  description = "Whether Cloudflare sees each zone's nameservers yet (`active`) or still waits (`pending`)."
  value = {
    "meltemi.dev"  = cloudflare_zone.dev.status
    "meltemi.page" = cloudflare_zone.page.status
  }
}

output "identity_database_id" {
  value = cloudflare_d1_database.identity.id
}

output "diagrams_database_id" {
  value = cloudflare_d1_database.diagrams.id
}

output "diagrams_bucket" {
  value = cloudflare_r2_bucket.diagrams_blobs.name
}

output "secrets_store_id" {
  value = cloudflare_secrets_store.family.id
}

output "workers" {
  description = "The Worker names the product repositories deploy to."
  value       = { for key, worker in cloudflare_worker.family : key => worker.name }
}

output "domains" {
  description = "The Custom Domains attached, by Worker."
  value       = { for key, domain in cloudflare_workers_custom_domain.family : key => domain.hostname }
}
