# ค่าที่ปรับได้ของ VM บน Azure — ตั้งใน terraform.tfvars (ดู terraform.tfvars.example)

variable "subscription_id" {
  description = "Azure subscription id (or set ARM_SUBSCRIPTION_ID)"
  type        = string
  default     = null
}

variable "resource_group" {
  type    = string
  default = "mini-siem-rg"
}

variable "location" {
  type    = string
  default = "eastasia"
}

variable "vm_name" {
  type    = string
  default = "mini-siem"
}

variable "vm_size" {
  type    = string
  default = "Standard_B2as_v2"
}

variable "disk_gb" {
  type    = number
  default = 40
}

variable "admin_username" {
  type    = string
  default = "azureuser"
}

variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/id_rsa.pub"
}

variable "admin_source_cidrs" {
  description = "Addresses allowed to SSH in, e.g. [\"198.51.100.10/32\"]"
  type        = list(string)

  validation {
    condition     = length(var.admin_source_cidrs) > 0 && !contains(var.admin_source_cidrs, "*")
    error_message = "SSH must be limited to known addresses."
  }
}

variable "syslog_source_cidrs" {
  description = "Addresses allowed to send syslog on 514. [\"*\"] opens it to the internet."
  type        = list(string)
  default     = ["*"]
}

variable "dns_label" {
  description = "Optional Azure DNS label: <label>.<location>.cloudapp.azure.com"
  type        = string
  default     = null
}
