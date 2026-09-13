# Azure VM สำหรับโหมด SaaS: resource group, network, NSG, static IP และ VM ที่ติดตั้ง Docker ด้วย cloud-init

terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

locals {
  inbound_rules = [
    { name = "allow-http", priority = 1001, protocol = "Tcp", port = "80", sources = ["*"] },
    { name = "allow-https", priority = 1002, protocol = "Tcp", port = "443", sources = ["*"] },
    { name = "allow-http3", priority = 1003, protocol = "Udp", port = "443", sources = ["*"] },
    { name = "allow-ssh", priority = 1004, protocol = "Tcp", port = "22", sources = var.admin_source_cidrs },
    { name = "allow-syslog-u", priority = 1005, protocol = "Udp", port = "514", sources = var.syslog_source_cidrs },
    { name = "allow-syslog-t", priority = 1006, protocol = "Tcp", port = "514", sources = var.syslog_source_cidrs },
  ]
}

resource "azurerm_resource_group" "siem" {
  name     = var.resource_group
  location = var.location
}

resource "azurerm_virtual_network" "siem" {
  name                = "${var.vm_name}-vnet"
  location            = azurerm_resource_group.siem.location
  resource_group_name = azurerm_resource_group.siem.name
  address_space       = ["10.60.0.0/16"]
}

resource "azurerm_subnet" "siem" {
  name                 = "default"
  resource_group_name  = azurerm_resource_group.siem.name
  virtual_network_name = azurerm_virtual_network.siem.name
  address_prefixes     = ["10.60.1.0/24"]
}

resource "azurerm_public_ip" "siem" {
  name                = "${var.vm_name}-ip"
  location            = azurerm_resource_group.siem.location
  resource_group_name = azurerm_resource_group.siem.name
  allocation_method   = "Static"
  sku                 = "Standard"
  domain_name_label   = var.dns_label
}

resource "azurerm_network_security_group" "siem" {
  name                = "${var.vm_name}-nsg"
  location            = azurerm_resource_group.siem.location
  resource_group_name = azurerm_resource_group.siem.name

  dynamic "security_rule" {
    for_each = local.inbound_rules
    content {
      name                       = security_rule.value.name
      priority                   = security_rule.value.priority
      direction                  = "Inbound"
      access                     = "Allow"
      protocol                   = security_rule.value.protocol
      source_port_range          = "*"
      destination_port_range     = security_rule.value.port
      destination_address_prefix = "*"
      source_address_prefix      = contains(security_rule.value.sources, "*") ? "*" : null
      source_address_prefixes    = contains(security_rule.value.sources, "*") ? null : security_rule.value.sources
    }
  }
}

resource "azurerm_network_interface" "siem" {
  name                = "${var.vm_name}-nic"
  location            = azurerm_resource_group.siem.location
  resource_group_name = azurerm_resource_group.siem.name

  ip_configuration {
    name                          = "primary"
    subnet_id                     = azurerm_subnet.siem.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.siem.id
  }
}

resource "azurerm_network_interface_security_group_association" "siem" {
  network_interface_id      = azurerm_network_interface.siem.id
  network_security_group_id = azurerm_network_security_group.siem.id
}

resource "azurerm_linux_virtual_machine" "siem" {
  name                  = var.vm_name
  location              = azurerm_resource_group.siem.location
  resource_group_name   = azurerm_resource_group.siem.name
  size                  = var.vm_size
  admin_username        = var.admin_username
  network_interface_ids = [azurerm_network_interface.siem.id]

  admin_ssh_key {
    username   = var.admin_username
    public_key = file(pathexpand(var.ssh_public_key_path))
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = var.disk_gb
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  custom_data = base64encode(templatefile("${path.module}/../../deploy/cloud-init.yaml", {
    admin_username = var.admin_username
  }))
}
