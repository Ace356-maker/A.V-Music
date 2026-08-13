; A.V Music · hooks del instalador NSIS.
;
; Tauri inyecta estos macros en el instalador generado (ver
; tauri.conf.json → bundle.windows.nsis.installerHooks).
;
; NSIS_HOOK_PREINSTALL  → corre justo antes de copiar los archivos.
; NSIS_HOOK_POSTINSTALL → corre al terminar de instalar.

!macro NSIS_HOOK_PREINSTALL
  ; Solo en instalaciones manuales (con ventana): si el instalador corre en
  ; silencio (actualización automática) se salta el mensaje, no pide clics.
  IfSilent +2
  MessageBox MB_ICONINFORMATION|MB_OK "Gracias, Ana Valentina, por inspirarme a crear A.V Music. ♥"
!macroend
