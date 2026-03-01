; Claude Terminal - Custom NSIS Installer Script
; Customizes the installer appearance and behavior
;
; NOTE: electron-builder already defines MUI_FINISHPAGE_RUN and related macros
; in assistedInstaller.nsh. Do NOT redefine them here to avoid conflicts.

; ============================================
; INSTALLER UI CUSTOMIZATION
; ============================================

; Welcome page
!define MUI_WELCOMEPAGE_TITLE "Welcome to Claude Terminal"
!define MUI_WELCOMEPAGE_TEXT "This wizard will install Claude Terminal on your computer.$\r$\n$\r$\nClaude Terminal is a premium terminal environment for managing Claude Code projects with integrated tools, Git management, and more.$\r$\n$\r$\nClick Next to continue."

; Finish page text (RUN options are handled by electron-builder)
!define MUI_FINISHPAGE_TITLE "Installation Complete"
!define MUI_FINISHPAGE_TEXT "Claude Terminal has been installed successfully.$\r$\n$\r$\nClick Finish to close this wizard."

; Abort warning
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Are you sure you want to cancel Claude Terminal installation?"

; Uninstaller
!define MUI_UNCONFIRMPAGE_TEXT_TOP "Claude Terminal will be uninstalled from your computer."

; ============================================
; CUSTOM MACROS
; ============================================

!macro customInit
  ; Custom initialization
  SetSilent normal
!macroend

!macro customInstall
  ; Safety-net: recreate the desktop shortcut if it was deleted by the old uninstaller
  ; during a transition update (old uninstaller had no ${isUpdated} guard).
  ; This ensures the shortcut always exists after install, regardless of upgrade path.
  ${ifNot} ${FileExists} "$DESKTOP\Claude Terminal.lnk"
    CreateShortCut "$DESKTOP\Claude Terminal.lnk" "$INSTDIR\Claude Terminal.exe"
  ${endIf}
!macroend

!macro customUnInstall
  ; Only clean up desktop shortcut on actual uninstall, NOT during update runs
  ; During updates, preserving the shortcut prevents taskbar pin loss
  ${ifNot} ${isUpdated}
    Delete "$DESKTOP\Claude Terminal.lnk"
  ${endIf}
!macroend
