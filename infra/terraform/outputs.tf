# ค่าที่ต้องใช้ต่อหลังสร้าง VM: IP, ชื่อโดเมน และคำสั่ง SSH

output "public_ip" {
  value = azurerm_public_ip.siem.ip_address
}

output "fqdn" {
  value = azurerm_public_ip.siem.fqdn
}

output "ssh" {
  value = "ssh ${var.admin_username}@${azurerm_public_ip.siem.ip_address}"
}
