; ═══════════════════════════════════════════════════════════════════════════
; Garde-fou contre un dossier d'installation tronqué.
;
; Défaut connu d'electron-builder : lorsque l'installateur n'est pas déjà
; élevé, il se relance en administrateur en transmettant le dossier
; d'installation par le paramètre « /D ». Un chemin contenant un espace
; (« C:\Program Files\StrasEdu ») y est coupé, et $INSTDIR devient
; « C:\Program ». Tout est alors installé à la racine du disque, et Windows
; avertit à chaque ouverture de session :
;
;   « Il existe un fichier ou un dossier nommé C:\Program sur votre ordinateur »
;
; Ce défaut ne se produit que dans ce cas précis — un administrateur qui lance
; l'installateur obtient le bon dossier, ce qui explique qu'il passe inaperçu
; sur un poste d'administration.
;
; On répare $INSTDIR AVANT toute écriture. « customInit » est inséré par
; electron-builder dans .onInit (vérifié sur ce projet). Le nom doit
; correspondre à « productName » de package.json.
; ═══════════════════════════════════════════════════════════════════════════

!macro customInit
  ${If} $INSTDIR == "C:\Program"
    StrCpy $INSTDIR "$PROGRAMFILES64\StrasEdu"
  ${EndIf}
!macroend
