# The two zones of the family on Cloudflare. Both domains stay registered at Dynadot (the owner's
# decision): Cloudflare serves their DNS only. Terraform creates the zones, or imports them when
# they were added in the dashboard first; their nameservers are an output, and the nameserver step
# (scripts/dynadot-nameservers.mjs) points the domains at them. A zone Terraform creates starts
# empty, so every record either zone has is declared here.

resource "cloudflare_zone" "dev" {
  account = { id = var.cloudflare_account_id }
  name    = "meltemi.dev"
  type    = "full"
}

resource "cloudflare_zone" "page" {
  account = { id = var.cloudflare_account_id }
  name    = "meltemi.page"
  type    = "full"
}

# A zone added in the dashboard before Terraform is imported, not created twice.
import {
  for_each = contains(keys(var.existing_zone_ids), "meltemi.dev") ? toset([var.existing_zone_ids["meltemi.dev"]]) : toset([])
  to       = cloudflare_zone.dev
  id       = each.value
}

import {
  for_each = contains(keys(var.existing_zone_ids), "meltemi.page") ? toset([var.existing_zone_ids["meltemi.page"]]) : toset([])
  to       = cloudflare_zone.page
  id       = each.value
}

# The IDE's landing on GitHub Pages: the apex's four A records and `www`, which were the domain's
# only records at Dynadot on 2026-10-21 (an ANAME and a CNAME to askenaz-dev.github.io; no mail, no
# TXT). Unproxied, so GitHub keeps serving its certificate. They go away in the commit that turns
# `apex_on_github_pages` false, and the family site's Custom Domain takes the apex in the same apply.
locals {
  github_pages_addresses = ["185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"]
}

resource "cloudflare_dns_record" "dev_apex_github_pages" {
  for_each = var.apex_on_github_pages ? toset(local.github_pages_addresses) : toset([])

  zone_id = cloudflare_zone.dev.id
  name    = "meltemi.dev"
  type    = "A"
  content = each.value
  proxied = false
  ttl     = 1
  comment = "GitHub Pages: the IDE's landing, until the family site takes the apex"
}

resource "cloudflare_dns_record" "dev_www_github_pages" {
  count = var.apex_on_github_pages ? 1 : 0

  zone_id = cloudflare_zone.dev.id
  name    = "www.meltemi.dev"
  type    = "CNAME"
  content = "askenaz-dev.github.io"
  proxied = false
  ttl     = 1
  comment = "GitHub Pages: redirects www to the IDE's landing, until the family site takes the apex"
}

# The GitHub Pages records a dashboard-added zone copied from Dynadot (its scan), imported by
# address so that Terraform owns them instead of creating duplicates.
import {
  for_each = var.apex_on_github_pages ? var.existing_apex_record_ids : {}
  to       = cloudflare_dns_record.dev_apex_github_pages[each.key]
  id       = "${lookup(var.existing_zone_ids, "meltemi.dev", "")}/${each.value}"
}
