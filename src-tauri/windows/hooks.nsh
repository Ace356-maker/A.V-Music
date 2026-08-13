; A.V Music · hooks del instalador NSIS.
;
; Tauri inyecta estos macros en el instalador generado (ver
; tauri.conf.json → bundle.windows.nsis.installerHooks).
;
; NSIS_HOOK_PREINSTALL  → corre justo antes de copiar los archivos.
; NSIS_HOOK_POSTINSTALL → corre al terminar de instalar.

!macro NSIS_HOOK_PREINSTALL
  MessageBox MB_ICONINFORMATION|MB_OK "Gracias, Ana Valentina, por inspirarme a crear A.V Music. ♥"
!macroend
