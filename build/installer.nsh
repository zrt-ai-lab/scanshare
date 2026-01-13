; 自定义卸载宏
!macro customUnInstall
  ; 删除应用数据目录
  RMDir /r "$APPDATA\扫享 ScanShare"
  
  ; 删除桌面快捷方式
  Delete "$DESKTOP\扫享 ScanShare.lnk"
  
  ; 删除开始菜单文件夹
  RMDir /r "$SMPROGRAMS\扫享 ScanShare"
  
  ; 删除用户数据中的上传文件夹
  RMDir /r "$LOCALAPPDATA\扫享 ScanShare"
!macroend
