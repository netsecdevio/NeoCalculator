# CALC-UNITS-02 — temperaturas afines y diferencias

Entrega local, 6 de octubre de 2026. Calculation admite temperaturas como
**puntos** y diferencias de temperatura como **cantidades lineales**, con
conversiones exactas y selección de salida independiente del valor.

El candidato validado está publicado en
`C:\.piobuild\numOS\emulator_pc\program.exe`, con sus DLL y
`previous-program.exe`. El lanzador habitual es
`./scripts/run-emulator-windows.ps1`. La entrega inicial se realizó sin flash
ni commit. El cierre físico WROOM y el único commit local se documentan al final.
No se ha desplegado la web ni realizado push.

[Galería: 46 originales 320×240](../out/calc-units-02/gallery/index.html) ·
[ZIP de la galería](../out/calc-units-02/gallery.zip) ·
[Manifiesto de imágenes](../out/calc-units-02/gallery/manifest.json).

## Architecture Assessment

Baseline real: `98b60786f04b152ce016f919f1bd9fe9fa88f785`,
`perf(units): accelerate output selection and streamline conversion`, rama
`main`. Se comprobaron HEAD, índice, working tree y worktrees antes de editar.
El índice estaba limpio; solo existía el archivo ajeno no seguido
`docs/RESUMEN_CHAT_TOOLBOX.png`. Este archivo y `.vscode/settings.json` conservan
sus hashes. No se modificaron los otros worktrees. La revisión manual aprobada
del baseline no se reabre.

La versión publicada estuvo disponible durante los builds, realizados en
`C:/.codex-cache/calc-units-02/`, fuera de su carpeta y antecesores. El ejecutable
inicial y sus runtimes se conservaron además en `out/calc-units-02/published-before/`.
`compile_commands.json`, generado temporalmente para obtener las órdenes nativas,
se restituyó al contenido y finales de línea originales; la base usada en las
pruebas está en `out/calc-units-02/native-compile-commands.json`.

Se mantienen el registro único, proveedor, filtros, favoritos, quick picker,
FORMAT/TABLE/ENG, renderer, STIX y pool LVGL de 64 KiB. No hay nueva app, fuente,
jerarquía virtual ni estructura afín por entrada de historial. WASM-MATH conserva
su frontera escalar; no se enlazó Toolbox/LVGL a ese headless.

### Fuentes primarias consultadas

Consulta realizada el 6 de octubre de 2026; las ecuaciones se verificaron con
racionales independientes en las pruebas, no únicamente con el registro.

| Fuente | Contrato verificado |
|---|---|
| [BIPM, SI Brochure, 9.ª edición, versión 4.01](https://www.bipm.org/documents/20126/41483022/SI-Brochure-9.pdf) | Kelvin como unidad SI de temperatura termodinámica; definición mediante el valor fijado de la constante de Boltzmann; Celsius desplazado exactamente 273.15 K; intervalos de igual valor numérico en K y °C. |
| [BIPM, prefijos SI](https://www.bipm.org/en/measurement-units/si-prefixes) | Prefijos decimales oficiales. No se cambian símbolos ni política de prefijos del catálogo. |
| [NIST SP 811](https://www.nist.gov/pml/special-publication-811) y [NIST, SI Units – Temperature](https://www.nist.gov/pml/owm/si-units-temperature) | Convenciones SI y ecuaciones exactas Celsius/Fahrenheit/kelvin; el intervalo Fahrenheit usa 5/9 K por grado. SP 811 es la publicación de 2008, no una supuesta edición de 2026. |
| [CEM, termometría de contacto](https://www.cem.es/es/laboratorio/termodinamica/laboratorio-termometria-contacto) | Relación entre temperatura Celsius y termodinámica; K y °C para intervalos. |
| [CEM, utilidades](https://www.cem.es/es/divulgacion/utilidades) | Conversión de Rankine a kelvin. |
| [UCUM 2.2, §43, tabla 17](https://ucum.org/ucum) | Definición computable de Fahrenheit, Rankine y Réaumur; para Réaumur, 5/4 K por grado y cero Celsius. Es una referencia de definición para la escala histórica, no una afirmación de que Réaumur sea SI. |

El [manual de Calculation de NumWorks](https://www.numworks.com/manual/calculation/)
sitúa las temperaturas en Calculation, dentro de Units and constants, y convierte
mediante el flujo de cantidades. Su [Toolbox documentado](https://www.numworks.com/manual/toolbox/)
enumera K, °C y °F. En esos documentos no se identifica una entrada explícita de
diferencia ni una tabla de operaciones punto/diferencia. La investigación
documental no permite atribuir un contrato interno al firmware actual; no se
presenta como una prueba de su simulador ni se afirma que sume dos puntos.
NumOS comparte la ubicación en Calculation, pero hace explícitos el rol editable,
la selección separada de diferencias y los errores afines. No se copiaron código,
tablas ni decisiones internas de NumWorks.

## Solution

### Valor propietario y transformaciones

`Quantity::Value` conserva coeficiente canónico exacto, dimensión, procedencia y
un enum cerrado: `Linear`, `TemperaturePoint`, `TemperatureDifference`.
`Owned` sigue siendo `shared_ptr<const Value>`. El rol pertenece al valor, no al
texto visible, a Toolbox ni a la unidad de presentación.

Para una coordenada `x`, el registro existente proporciona `scale` y `offset`:

```text
punto:       canonical = scale * x + offset
salida:      x = (canonical - offset) / scale
diferencia:  canonical_difference = scale * x
salida Δ:    x = canonical_difference / scale
```

Se reutilizan `conversion`, `Exact`, `scale` y `offset`; CalculationApp no
contiene casos por nombre de escala. El coeficiente canónico es una expresión
exacta normalizada por Giac; `double` no decide igualdad, compatibilidad ni
conversión. La aproximación existente solo prepara la vista Decimal.

| Escala ya existente | UnitId base | Scale exacto | Offset exacto respecto a K |
|---|---:|---:|---:|
| K | 5 | 1 | 0 |
| °C | 23 | 1 | 5463/20 |
| °F | 60 | 5/9 | 45967/180 |
| °R (Rankine) | 1180 | 5/9 | 0 |
| °Ré (Réaumur) | 1181 | 5/4 | 5463/20 |

Las cinco escalas admiten punto y diferencia; no se añadieron escalas.
Las 202 definiciones permanecen en el catálogo. Las 190 definiciones
multiplicativas conservan sus campos matemáticos del baseline; se activan tres
definiciones antes afines pendientes, para un total de 193 calculables.
K y Rankine tienen offset cero, pero su entrada de temperatura sigue siendo un
punto. La semántica nueva de los puntos se aplica también a esas dos escalas.

Un escalar seguido del átomo de unidad de punto construye una coordenada:
`-40 °F` aplica el signo a 40 antes del desplazamiento. Este enlace de entrada
(implícito o mediante el operador de unión existente) no es una multiplicación
de un punto ya construido. Un punto entre paréntesis, en Ans o en A–F no puede
usarse como unidad para construir otro. `20 °C * 2`, `2 * (20 °C)` y
`Ans * 1` se rechazan; convertir antes la vista a K no cambia esa respuesta.

No se impone `T >= 0 K`. Por ejemplo, las pruebas convierten coordenadas
Celsius/Fahrenheit inferiores al cero absoluto sin truncarlas ni ocultarlas.

### Tabla de operaciones

Para dimensiones compatibles, la suma/resta usa dos matrices `constexpr`
explícitas. `P,Q` son puntos y `d,e` diferencias:

| Operación | Resultado |
|---|---|
| P − Q | Diferencia |
| P + d | Punto |
| d + P | Punto |
| P − d | Punto |
| d + e | Diferencia |
| d − e | Diferencia |
| P + Q | `affine_operation` |
| d − P | `affine_operation` |
| Punto × cantidad, cantidad × punto, cociente con punto | `affine_operation` |
| Potencia o raíz de punto, incluso exponente 0/1 | `affine_operation` |
| abs(punto), sin/cos/log/exp(punto) | Error afín/dimensional, sin borrar unidades |
| abs(diferencia), escalar × diferencia, diferencia / escalar | Operación lineal |
| Diferencia × tiempo | Cantidad lineal de dimensión compuesta |
| Diferencia / diferencia | Escalar al cancelar dimensiones |
| Función trascendental de una diferencia | Error dimensional; válida después de quedar adimensional |

Los errores se detectan antes de enviar un escalar simplificado a Giac y no se
convierten en Syntax ERROR. El diagnóstico EN/ES es «Operation undefined for
temperature points» / «Operación no definida para puntos de temperatura».
Después de cada error comprobado, `2+2` funciona sin reiniciar Giac.

### Toolbox, notación y AST

La ruta es **Toolbox → Unidades → Temperatura → Diferencia de temperatura**.
Las filas habituales de Temperatura insertan puntos. La nueva subcategoría
reúne K, °C, °F, °Ré y °R como diferencias. Reutiliza proveedor, acción principal,
RIGHT según las variantes ofrecidas, FORMAT de favoritos, búsqueda y pestañas
existentes; no se amplía la oferta de prefijos.

`ΔK`, `Δ°C`, `Δ°F`, `Δ°Ré`, `Δ°R` son una notación de edición de NumOS:
**Δ marca el rol diferencia; no redefine el símbolo oficial de la unidad**.
BIPM permite expresar intervalos en K o °C; la adición de Δ es la decisión de
producto para hacer inequívoco el AST. Se usa el glifo Delta de STIX existente.

`Atom` contiene el mismo UnitId base y un `TemperatureRole` tipado. No se analiza
el texto «Δ°C», y una variable/símbolo libre Delta junto a Celsius no adquiere
ese rol. `makeUnit` normaliza en la frontera; clonación, edición, borrado,
paréntesis, fracciones y composición de resultados conservan el átomo.
Calculation no tiene una pila general de undo; se comprueban DEL, clonación y
recuperación de historial disponibles, sin inventar otra persistencia.

El codec de átomo sigue ocupando cinco bytes. La versión 2 guarda el enum en el
nibble alto del byte de versión; longitudes, versiones y roles desconocidos se
rechazan sin modificar el destino. El default de una unidad de temperatura es
punto. Los tres IDs de diferencia anteriores se normalizan al UnitId base con
rol Difference mediante una tabla pequeña del registro. Se mantienen las
definiciones, pero no se construyó un proyecto de migración de datos: el usuario
aclaró que no existen datos anteriores que preservar.

Favoritos conserva identidades distintas de ítem para punto y diferencia de
Celsius. La recuperación, incluida una recarga real IDBFS, mantiene cada rol.
Las búsquedas incluyen celsius, fahrenheit, temperature/temperatura,
temperature difference/diferencia temperatura/diferencia de temperatura,
delta c y aliases existentes. La nueva prosa comparte EN y ES en en-US, en-GB,
es-ES y es-419; no cambia símbolos, separador decimal ni reglas de entrada.

### FORMAT, Ans y sesiones

**SHIFT → ALPHA → FORMAT → Unidad de salida** filtra por dimensión y rol,
también al elegir componentes. Un punto ofrece escalas de punto y una diferencia
ofrece escalas de diferencia. Las sugerencias habituales son K/°C/°F con su rol;
siguen disponibles Todas las unidades, SI predeterminado y favoritos compatibles.
Se añadió la selección de estas familias, conservando el proveedor optimizado.
No se presenta una nueva campaña de rendimiento del selector anterior.

La conversión parte siempre del canónico inmutable; la vista anterior no sirve
como entrada. SI predeterminado muestra K para puntos y ΔK para diferencias.
Exact conserva, por ejemplo, `5463/20 K`; Decimal puede mostrar `273.15 K`.
No hay una regla especial que fuerce decimales o fracciones para temperaturas.

Ans, PreAns, historial de 50 entradas y A–F de sesión transportan `Owned` con su
rol. Se verifica `20 °C → vista °F → vista K → Ans − 32 °F = 20 ΔK`;
un error afín conserva el Ans anterior. El historial recupera puntos y
diferencias y permite reevaluarlos. No se amplió la persistencia durable de A–F.

### Validación ejecutada

Evidencias bajo `out/calc-units-02/`. Los logs esenciales originalmente ubicados
en caché se conservaron en `essential/`. No se promovieron goldens ni se
ampliaron máscaras; las 900 trazas solo excluyen los dos campos temporales que
ya excluía su comparación anterior.

| Prueba | Resultado y evidencia |
|---|---|
| Temperaturas host | 1436 aserciones exactas/de rol; `essential/temperature-final/` |
| Cantidades previas | 42 casos, 6335 aserciones, 193 definiciones/1921 variantes atómicas, 105 factores independientes; `essential/host/quantity_calculation_checks.log` |
| Límites y recuperación | 13 comprobaciones focalizadas; `quantity_closeout_checks.log` |
| Datos independientes | 2187 comprobaciones y 17 controles mutados; `expanded-data.log` |
| Preservación de definiciones | 190 contratos matemáticos comparados con HEAD; `baseline-math-contract.json` |
| Temperaturas con teclas reales | 29 casos, 421 aserciones; `product-final/results.json` |
| Cantidades previas en UI | 23 casos, 404 aserciones; `multiplicative-product/` |
| Calculation, entrada escalar | 113 casos; `calculation-input/` |
| FORMAT escalar / texto EN-ES | 28 casos / 2 recorridos; `format/`, `format-presentation/` |
| Quick picker | 14 casos, 211 aserciones; `picker/`; sugerencias de temperatura verificadas además por tipo |
| Catálogo y favoritos UI | 36 casos; `catalog-product/` |
| Catálogo host / sugerencias | 26504 comprobaciones / 80 sugerencias compatibles; `essential/host/` |
| Toolbox y fallos persistentes | 8184479 comprobaciones, 27273 inyecciones; `essential/corpus-host/toolbox_checks.log` |
| Fallos de asignación de cantidades | 22 casos/226 aserciones previos; 16 casos/147 aserciones afines; `faults/`, `temperature-faults/` |
| Editor/layout existentes | Editor con 33 puntos de fallo persistente; spacing 821 y brackets 1645 comprobaciones, sin fallos |
| Corpus congelado | 900 trazas coinciden; `corpus900/comparison.json` |
| Historial lleno, pool fijo | 100 ciclos medidos tras 4 warmups, 60 evaluaciones para llenar 50 entradas en cada ciclo; `lifecycle-verified/` |
| Builds | Windows nativo, WROOM y CAM correctos; `build-native-2.log`, `build-firmware.log` |
| Chromium/Firefox/WebKit | Temperaturas en seis superficies, cantidades/favoritos con recarga IDBFS, FORMAT en seis superficies, 24 recorridos de locales; `web/` |
| WebKit acumulado separado | 8 recorridos, dos superficies × cuatro locales; `web/webkit-accumulated/` |
| Publicación y lanzador | Script autorizado + `0 °C`, `18 Δ°F`, `2+3`; `publish.log`, `published-launcher.log` |

Los oráculos de temperatura usan aritmética racional independiente para
`F=C*9/5+32`, `C=(F-32)*5/9` y `K=C+27315/100`, incluyendo -40, valores
negativos Fahrenheit, ebullición y Réaumur. Los 55 escenarios generados acotados
verifican `(P+d)-P=d`, `(P-Q)+Q=P`, conservación de canónico en cambios sucesivos
de vista de puntos/diferencias y reevaluación del AST compuesto. Los factores
externos se comprueban además de esas identidades.

Se rechazaron las **12 mutaciones afines obligatorias**, conservando logs de
compilación y del detector: offset sobre diferencia, ausencia de offset sobre
punto, factor Fahrenheit invertido, suma de puntos, conversión que cambia rol,
pérdida de rol en Ans, doble offset, inferencia contextual de diferencia,
favorito que cambia rol, signo Fahrenheit incorrecto, factor Réaumur incorrecto
y conversión desde el display anterior. Pasan también las 12 mutaciones
multiplicativas anteriores. Resultados en
`essential/temperature-mutations-final/` y `essential/multiplicative-mutations/`.

Los scripts reproducibles nuevos son `test-temperature-product.py`,
`test-temperature-lifecycle.py`, `test-temperature-faults.py`,
`test-temperature-mutations.py`, `profile-temperature-host.py` y
`tests/wasm/calculation-temperatures.mjs`; sus argumentos están en `--help` o en
las variables de entorno del harness. Los host checks usan
`scripts/test-tutor-composition-host.py` con `--tests temperature_checks`, objetos
del candidato y la base nativa conservada. Los builds usan
`PLATFORMIO_BUILD_DIR=C:/.codex-cache/calc-units-02/native` o `.../firmware`,
nunca el árbol publicado.

## Memory & Typographic Profile

Tamaños reales de DWARF Xtensa, comparados con el baseline aceptado:

| Tipo | Antes | Después |
|---|---:|---:|
| Value | 44 B | 44 B |
| Owned | 8 B | 8 B |
| HistoryEntry | 160 B | 160 B |
| CalculationEvaluation | 200 B | 200 B |
| CalculationApp | 1008 B | 1008 B |
| NodeUnit | 52 B | 52 B |
| Atom | 4 B | 4 B |
| Descriptor | 112 B | 112 B |

Los enums consumen relleno existente. Fuentes de medida:
`baseline-resources-firmware.json`, `resources/resources-firmware.json` y
`owned-sizes.json`.

| Firmware | Imagen antes | Imagen después | Incremento | Libre en app de 6553600 B |
|---|---:|---:|---:|---:|
| WROOM | 6266912 B | 6269680 B | 2768 B | 283920 B |
| CAM | 6179376 B | 6181984 B | 2608 B | 371616 B |

Ambos superan los 131072 B mínimos. La tabla de particiones no cambia.
RAM estática: WROOM 119672 B y CAM 118264 B, sin crecimiento.
Texto IRAM: WROOM 60407 B y CAM 59039 B, sin crecimiento.

Pila Xtensa, **frames propios**: `convert` 496→528 B, `Walker::node` 352→320 B,
nuevo `attach` 192 B; `contains` 1696 B y `exponent` 640 B sin cambio. No son
mediciones de la pila total de tarea: el walker sigue limitado a profundidad 16,
192 nodos, 64 llamadas escalares y 2000 caracteres; hay llamadas recursivas y
Giac además de esos frames. No se ha medido el high-water mark físico.

El sondeo host `new/new[]` más AST, con una coordenada grande, da picos locales
de 709 B en análisis, 1805 B en conversión y 256 B en composición; delta vivo
respectivo 191/1410/240 B. No incluye malloc C de Giac ni el heap total ESP32;
no se presenta como una medida de PSRAM. Detalle de nueve ámbitos en
`heap-profile/allocations.json`.

En los 100 ciclos con pool de 64 KiB, el mínimo libre muestreado en modal fue
6224 B y el bloque mayor mínimo 5584 B. HOME vuelve siempre a 67 objetos,
3 timers, 19352 B libres y 0 handles, sin deriva. El allocator informa 57696 B
utilizables después de sus reservas internas. No son mínimos continuos entre
muestras ni una garantía de margen para cualquier AST posible.

Layout/draw/cursor no cambian sus fórmulas geométricas ni añaden asignaciones;
Δ se suministra por el mismo `units::symbol` que calcula y dibuja la unidad.
Las capturas revisadas muestran Δ, °, negativos y fracciones sin clipping, con
pies legibles y distinción de roles en FORMAT, favoritos y cuatro locales.
La alineación se comprobó en el emulador y las regresiones existentes; no se
atribuye revisión humana del LCD.

## Risks & Edge Cases

- **Hardware pendiente:** no hubo flash. Stack total, presión real de PSRAM,
  latencias de cache y aspecto del LCD necesitan la comprobación física posterior.
- **WebKit histórico:** las ocho ejecuciones acumuladas actuales están verdes;
  los incidentes históricos de cierre siguen sin causa demostrada. Esta pasada
  no los explica ni los elimina del registro de regresiones.
- **Intentos de pruebas conservados:** los primeros guiones de ciclos enviaban
  BACK de más y acababan en el launcher. Fallaban aserciones y, en ese cierre
  anticipado, se observó SIGSEGV de teardown nativo en `lv_group_delete`/MainMenu.
  Se conservan `lifecycle/`, `lifecycle-final/`, `life-gdb.log` y los reproducers.
  El recorrido correcto termina 100 ciclos sin fallo; no se afirma haber
  corregido ese teardown fuera del alcance afín.
- El intento de enlazar `calculation_format_checks.cpp` con el runner genérico
  carecía de MathCanvas y no cuenta como prueba pasada. FORMAT se verificó con
  sus recorridos reales y el observador correspondiente, más las seis superficies
  web; el renderer conserva sus tests de spacing/brackets. No se modificó una
  prueba antigua para convertir ese fallo de harness en verde.
- Se mantienen los límites de cantidades reales cerradas. No se habilitan
  incertidumbre, constantes físicas medidas, Mach/dB/pH, termodinámica,
  calendario, unidades en otras apps, persistencia durable A–F ni operaciones
  arbitrarias sobre puntos. Se conservan las entradas y diagnósticos específicos.
- Una fase futura podría distinguir una temperatura termodinámica utilizable en
  `pV=nRT` o radiación `T^4`. Este contrato no hace esa elevación implícita al
  convertir visualmente a K.

### Checklist físico de la entrega inicial

- [x] WROOM: autorización fresca y aplicación anterior conservada; aceptación
  documentada en el cierre. La aceptación física CAM queda fuera de este cierre.
- [x] Comprobar teclas reales: Toolbox → Temperatura → Diferencia, RIGHT,
  favoritos punto/diferencia y búsqueda EN/ES.
- [x] Ver `0 °C → K`, `32 °F → °C`, `-40 °C → °F`, `80 °Ré → °C`, Exact/Decimal.
- [x] Ver `20 °C − 10 °C → 10 ΔK → 18 Δ°F` y `20 °C + 10 Δ°C → 30 °C`.
- [x] Ver error punto+punto, producto/potencia de punto y `2+2` posterior.
- [x] Cambiar °C→°F→K y comprobar Ans, PreAns, historial y A–F durante la sesión.
- [x] Inspeccionar Δ, °, signos, fracciones, cursor, pies y cuatro locales en LCD.
- [x] Repetir historial lleno/cancelaciones y medir pila, heap/PSRAM y estabilidad
  con el pool real de 64 KiB.

## Alternatives Considered

Un enum pequeño conserva el modelo de Quantity y evita una jerarquía de puntos
con asignaciones/vtables. Guardar solo coordenada y UnitId, inferir diferencias
por vecindad o permitir productos después de mostrar K haría depender la
matemática de la presentación. Se descartaron esas opciones. El registro ya
contiene los parámetros afines y permite ampliar escalas válidas sin casos
especiales en CalculationApp; solo temperatura activa esta semántica.

### Archivos exactos de la entrega

Código/datos:

```text
src/apps/CalculationApp.cpp
src/math/MathAST.cpp
src/math/Quantity.cpp
src/math/Quantity.h
src/math/units/UnitRegistry.h
src/math/units/registry.json
src/math/units/UnitRegistryData.inc
src/math/units/UnitToolboxEntries.inc
src/math/units/UnitNavigationIndex.inc
src/ui/UnitQuickChoices.h
scripts/generate-unit-catalog.py
```

Pruebas/medidas:

```text
scripts/profile-temperature-host.py
scripts/test-temperature-faults.py
scripts/test-temperature-lifecycle.py
scripts/test-temperature-mutations.py
scripts/test-temperature-product.py
scripts/test-quantity-mutations.py
scripts/test-unit-picker.py
tests/host/temperature_checks.cpp
tests/host/quantity_calculation_checks.cpp
tests/host/unit_catalog_checks.cpp
tests/wasm/calculation-temperatures.mjs
tests/wasm/calculation-quantities.mjs
```

Documentación:

```text
docs/CALC_UNITS_02_TEMPERATURE.md
docs/UNIT_CATALOG_02_INVENTORY.md
```

Son 25 archivos; no incluyen el PNG preexistente ni artefactos ignorados de
`out/`. `out/calc-units-02/final-receipt.json` registra hashes del delta,
preservación de archivos ajenos, builds, publicación y estado final de Git.
En la entrega inicial el índice quedó sin staging y HEAD sin cambios. El cierre
posterior prepara exactamente estos 25 archivos para el commit local indicado abajo.


## Cierre físico WROOM — 6–7 de octubre de 2026

### Architecture Assessment

El cierre conserva el runtime candidato: no hay correcciones de producción.
La comparación de la imagen completa y las secciones ELF permite reutilizar la
matriz previa. Se mantienen renderer, STIX, geometría y pool LVGL de 64 KiB.
La instrumentación solo existió en una copia privada opt-in fuera del repositorio.

### Solution

**Identidad inicial:** main, HEAD
`98b60786f04b152ce016f919f1bd9fe9fa88f785`, índice limpio y delta de 25 archivos.
Se inspeccionaron rama, índice, working tree y worktrees. Snapshot completo de
1.459 archivos, parches binarios separados, archivos nuevos, manifiesto/hashes,
ejecutable publicado, previous-program.exe y DLL están en
`out/calc-units-02-temperature-closeout/A-received/`; las evidencias anteriores
se conservaron completas en `received-evidence/`. No se usó stash/reset/clean.

Fingerprint de fuentes/runtime:
`623f64f7736c6cb9f055385cf7a77c6f7ebe49f3df6182a39bb7ddab1a7c0241`.
Herramientas fijadas: PlatformIO 6.1.19, espressif32 6.12.0,
Arduino 3.20017.241212+sha.dcc1105b, Xtensa 8.4.0+2021r2-patch5 y esptool 4.9.0.
El manifiesto de herramientas y 2.530 archivos de runtime está en
`tool-runtime-fingerprint.json`. La recompilación ordinaria inicial pasó y es
idéntica byte a byte a la imagen previamente validada. Un intento incremental
final falló al cargar FortranCommon de SCons tras cambiar su instalación entre
versiones de PIO. Se conserva el log; el reintento con PIO 6.1.19 y SCons
4.40801.0 pasó, conservando el mismo binario. No se modificó código para
resolver ese incidente del entorno.

**PCB redescubierta:** USB 303A:1001, serie/MAC `44:B1:76:A7:B7:2C`,
ESP32-S3 rev. 0.2, 16 MiB flash, 8 MiB PSRAM. Puerto observado COM9, resuelto por
identidad USB en cada operación. app0 activa: offset `0x10000`, capacidad
6.553.600 B. La aplicación anterior se leyó dos veces completa y coincidió:
SHA-256 de partición
`cde68028138750e5fbaa0b90f0fd51fa9926df967ee16b7c5771437b8ef812aa`;
imagen recuperable de 6.266.912 B, digest interno válido, SHA-256
`307341cf2a29dd8c2770d9ea8d242648b1dfb11300dda7f16d1df1a79a18c6cc`.
Los originales permanecen en `board-before/`.

La autorización se pidió una vez y recibió «si adelante»; alcance registrado en
`authorization.json`: solo aplicación, sonda temporal y restauración ordinaria.
No se escribieron bootloader, tabla, OTA selector ni eFuses; no se borró toda la
flash ni se formatearon NVS/LittleFS. Los cambios normales de preferencias del
producto se preservaron. CPU 240 MHz y brillo 144 permanecieron constantes.

**Firmware ordinario instalado:** SHA-256
`7aac4006651624212d7561061436121e1781c9ce5b43d22fe528fd93b562c1a6`.
Imagen 6.269.680 B; linked flash 6.269.313 B; margen app 283.920 B;
RAM estática 119.672 B; IRAM 60.407 B. La escritura fue exclusivamente app0;
verify_flash y lectura independiente de toda la imagen verificaron sus bytes y
hash. El prefijo completo de 64 KiB antes/después permaneció idéntico en cada
instalación. `ordinary-final-switch/operation.json` y sus logs contienen la prueba.
Arranque normal verificado en `ordinary-boot.log`. Marcadores y símbolos de la
sonda están ausentes del ordinario (`ordinary-not-instrumented.json`). La sonda
privada medía 6.292.208 B, RAM 120.032 B y nunca entra en este commit.

**Evidencia host:** puertas frescas: temperatura 1.436 aserciones, cantidades
6.335, 12 mutaciones de temperatura rechazadas, Calculation input gate 113,
FORMAT 28, picker 14 casos y diff --check. Se reutiliza por identidad la matriz
completa previa: 190 definiciones multiplicativas con oráculos independientes,
mutaciones anteriores, 100 ciclos host, 900 trazas, native/WROOM/CAM,
Chromium/Firefox/WebKit, shell/componente, favoritos y cuatro locales.
WebKit acumulado permanece separado; los incidentes históricos no se consideran
explicados por esta pasada. No se promovieron goldens ni ampliaron máscaras.

**Evidencia física automatizada:** 39 casos únicos y 5 complementarios PASS,
introducidos por eventos de contactos reales en el recorrido de producto, sin
inyectar fórmulas/AST. La búsqueda auxiliar solo inyectaba el texto de búsqueda;
se probaron también «celsius» y «diferencia temperatura» con contactos ALPHA.
La sonda observó roles, UnitId, canónico exacto, descriptor, Ans/PreAns y memoria.
Los logs originales y las aserciones están en `physical/`,
`physical-acceptance.json` y `additional-acceptance.json`.

- Puntos: 0 °C ↔ 5463/20 K, 100 °C → 7463/20 K, 32 °F → 0 °C,
  212 °F → 100 °C, −40 °C → −40 °F, 80 °Ré → 100 °C,
  491.67 °R → 5463/20 K. Exact/Decimal, BACK, FORMAT y HOME/reentrada pasan.
- Diferencias: 20 °C − 10 °C → 10 ΔK → 10 Δ°C → 18 Δ°F;
  68 °F − 32 °F → 20 ΔK/Δ°C; 18 Δ°F y 8 Δ°Ré → 10 ΔK.
  FORMAT filtra por rol; sus búsquedas de Celsius recuperan punto o diferencia
  según el valor. Las conversiones repetidas conservan el canónico.
- Álgebra: 20 °C + 10 Δ°C → 30 °C; 20 °C − 18 Δ°F → 10 °C;
  10 ΔK + 32 °F → 50 °F; 2×5 ΔK → 10 ΔK; 10 ΔK/2 → 5 ΔK;
  10 ΔK/5 ΔK → 2; abs(−18 Δ°F) → 10 ΔK.
- Errores: punto+punto, diferencia−punto, ambos órdenes de producto con 2,
  potencia, sqrt, abs, ln y sin de punto producen affine_operation.
  Mostrar primero K no los habilita. 2+2 funciona después de los errores sin
  reiniciar Giac y el error conserva el Ans anterior.
- Ans: 20 °C, mostrar °F y K, Ans−32 °F → 20 ΔK con canónico original
  5863/20 y rol Point intactos. PreAns, recuperación de puntos/diferencias,
  edición y reevaluación pasan.
- A–F: A estaba libre (los seis slots eran cero). Se guardó/recuperó un punto,
  se sustituyó por diferencia y se comprobaron ambos roles. Tras guardado
  ordinario y reinicio A vuelve al escalar 0 sin rol de cantidad; no hay
  persistencia durable nueva. B–F intactos (`session-slot.json`).
- Toolbox/favoritos: rutas EXE/RIGHT, variantes, búsqueda, favoritos separados
  para °C y Δ°C, inserción y supervivencia al reinicio pasan. Se retiraron solo
  los favoritos añadidos: estado final exactamente igual al inicial, vacío
  (`favorites-preserved.json`). Muestras en en-US, en-GB, es-ES y es-419 pasan.

Los primeros intentos fallidos del harness se conservan: alias decimal ausente,
atajo abs no implementado previamente (se usó Toolbox), cursor de historial,
orden de resultados de búsqueda y exceso de BACK/HOME. Se corrigió únicamente
el conductor de pruebas privado para seguir el estado observado; no el runtime,
las expectativas matemáticas ni los goldens. Los 15 ciclos válidos constituyen
una ventana nueva completa con Giac vivo.

**Observación humana del LCD:**

- Diferencia, Δ/°, signos/fracciones y significado: PASS — Sí, se distingue y se lee bien.
- Error punto+punto: PASS funcional; el usuario confirma «Si, sale
  "Operación no definida para puntos de temperatura"» en el smoke D.
- Revisión visual/editorial detallada del mensaje: DIFERIDA. Esa confirmación
  funcional no se interpreta como una aprobación editorial adicional.
- Smoke ordinario final sin sonda: **PASS**, cinco pasos confirmados uno a uno
  por el usuario en `CALC-UNITS-02-FINAL-SMOKE-AND-COMMIT`.

| Paso manual | Recorrido y resultado confirmado | Respuesta real |
|---|---|---|
| A | Calculation; 0 °C desde Toolbox; EXE; FORMAT → Unidad de salida → K; 273.15 K o exacto equivalente, símbolos legibles y sin error inesperado | «Si, todo bien» |
| B | 20 °C − 10 °C → 10 ΔK o vista equivalente de diferencia | «Todo bien» |
| C | 20 °C + 10 Δ°C, entrada explícita Diferencia de temperatura en Toolbox; salida °C → 30 °C | «si» |
| D | 20 °C + 10 °C → error claro sin resultado numérico falso | «Si, sale "Operación no definida para puntos de temperatura"» |
| E | Sin reiniciar, 2+2 → 4; regreso normal a HOME | «claro» |

Las respuestas y fechas se conservan en `manual-final-smoke.json`. La aprobación
existente de Δ/° y del significado de diferencia se mantiene. Estado visual
global **PARCIAL**, con `TEMPERATURA_LCD_ERROR_MESSAGE: DIFERIDA`.

La observación humana se distingue de las aserciones físicas y las 46 capturas
originales 320×240 del emulador. No se atribuye una fotografía ni una inspección
humana adicional. El smoke ordinario requiere teclas del usuario: el puente
serial ordinario no controla Toolbox/FORMAT y no se añadió una API permanente.
La captura pasiva anterior está en `ordinary-physical-keys.log`: terminó sin
eventos de teclas físicas y no se usa como evidencia del smoke manual. Sus
confirmaciones proceden de las respuestas humanas anteriores.

Esta fase final no escribe ni relee la aplicación, no reinstala la sonda,
no recompila firmware ni repite campaña física, tiempos, ciclos o navegadores.
Reutiliza expresamente la aceptación ya documentada y su lectura completa del
ordinario. No hay cambios de runtime desde aquella aceptación. El commit
guarda exactamente las mismas fuentes de runtime: cambiar HEAD no cambia el
binario instalado ni su SHA-256. Solo se completa esta sección del informe.

### Memory & Typographic Profile

Tiempos de scopes internos en **microsegundos**, no tiempo al primer píxel.
Primera ejecución registrada por operación tras reinicio verificado; el estado
de calentamiento compartido difiere por operación. Cada fila tiene 10
repeticiones calientes; p95 usa rango más próximo y con n=10 coincide con el
máximo caliente. Las muestras crudas están en `timing-summary.json` y
`measure-series.json`. Scope 5 evalúa Calculation antes del flush; 10 convierte
la salida seleccionada; 11 distingue apertura FORMAT y apertura del picker;
8 publica la salida, sin medir el refresco posterior del LCD.

| Operación / etapa | Primera µs | Mediana caliente µs | p95 µs | Máximo caliente µs | n caliente |
|---|---:|---:|---:|---:|---:|
| zero-celsius / evaluate (scope 5) | 36617 | 33814.5 | 34400 | 34400 | 10 |
| negative-forty / evaluate (scope 5) | 34029 | 34087 | 34246 | 34246 | 10 |
| point-minus-point / evaluate (scope 5) | 30165 | 30014.5 | 30296 | 30296 | 10 |
| point-plus-difference / evaluate (scope 5) | 35139 | 35124 | 35166 | 35166 | 10 |
| point-plus-point-error / evaluate (scope 5) | 20236 | 19538 | 19806 | 19806 | 10 |
| multiplicative-control / evaluate (scope 5) | 28536 | 28572 | 28635 | 28635 | 10 |
| scalar-control / evaluate (scope 5) | 20752 | 21442 | 21517 | 21517 | 10 |
| point-display-Degree Celsius / format-root-open (scope 11) | 13092 | 13102.5 | 13162 | 13162 | 10 |
| point-display-Degree Celsius / output-unit-picker-open (scope 11) | 18698 | 18775.5 | 18796 | 18796 | 10 |
| point-display-Degree Celsius / publish-output (scope 8) | 6647 | 6170 | 6228 | 6228 | 10 |
| point-display-Degree Celsius / convert-selected-output (scope 10) | 3986 | 4029 | 4064 | 4064 | 10 |
| point-display-Degree Fahrenheit / format-root-open (scope 11) | 13077 | 13089 | 13128 | 13128 | 10 |
| point-display-Degree Fahrenheit / output-unit-picker-open (scope 11) | 18697 | 18690.5 | 18746 | 18746 | 10 |
| point-display-Degree Fahrenheit / publish-output (scope 8) | 6549 | 6548 | 6560 | 6560 | 10 |
| point-display-Degree Fahrenheit / convert-selected-output (scope 10) | 4416 | 4416.5 | 4429 | 4429 | 10 |
| difference-display-delta c / format-root-open (scope 11) | 13099 | 13091 | 13145 | 13145 | 10 |
| difference-display-delta c / output-unit-picker-open (scope 11) | 19130 | 19031.5 | 19080 | 19080 | 10 |
| difference-display-delta c / publish-output (scope 8) | 6195 | 6208.5 | 6219 | 6219 | 10 |
| difference-display-delta c / convert-selected-output (scope 10) | 3416 | 3427 | 3434 | 3434 | 10 |
| difference-display-delta f / format-root-open (scope 11) | 13064 | 13084.5 | 13122 | 13122 | 10 |
| difference-display-delta f / output-unit-picker-open (scope 11) | 19063 | 19002.5 | 19026 | 19026 | 10 |
| difference-display-delta f / publish-output (scope 8) | 6443 | 6439 | 6486 | 6486 | 10 |
| difference-display-delta f / convert-selected-output (scope 10) | 3657 | 3653.5 | 3679 | 3679 | 10 |

Tras dos ciclos de calentamiento e historial estabilizado en 50 entradas se
compararon **15 ciclos mixtos** sin reiniciar Giac: puntos, diferencias, FORMAT,
favoritos, historial, Ans, error/recuperación, HOME y cuatro locales repartidos.

| Métrica física (bytes salvo recuentos) | Calculation | HOME |
|---|---:|---:|
| Heap interno libre / mayor bloque | 143.112 / 98.292 constantes | igual |
| PSRAM libre mín–máx | 8.174.655–8.174.999 | 8.175.351–8.175.699 |
| PSRAM primer→último | 8.174.827→8.174.763 | 8.175.523→8.175.455 |
| Mayor bloque PSRAM | 8.126.452 constante | igual |
| LVGL libre / mayor bloque | 37.704–37.712 / 29.400 | 41.000 / 29.400 |
| LVGL mínimo libre observado | 30.120 | 30.120 |
| Objetos / pantallas / timers | 86 / 6 / 3 constantes | 71 / 5 / 3 constantes |
| Pila mínima libre loopTask | 56.964 | 56.964 |

La unidad de pila se verificó con sizeof(StackType_t)=1; la pila configurada es
65.536 B. No se midieron todos los workers. Las oscilaciones de PSRAM de
344/348 B se revierten y los mayores bloques/recuentos permanecen constantes;
no hay bajada sostenida en esta ventana. No se forzó agotamiento del heap.
Datos completos en `memory-cycles.json` y `memory-summary.json`.
Tamaños Xtensa conservados: Value 44, Owned 8, HistoryEntry 160,
CalculationEvaluation 200, CalculationApp 1.008, NodeUnit 52, Atom 4 B.
Bounding Box Alignment: renderer/spacing y capturas previamente validados;
este cierre no cambia geometría ni fuentes.

### Risks & Edge Cases

- La aceptación física cubre esta WROOM; CAM cuenta con build/regresión host,
  sin atribuirle aceptación física.
- El mínimo de pila corresponde a loopTask y el muestreo no demuestra un pico
  exhaustivo de todas las tareas/allocations.
- Se conservan los incidentes históricos WebKit y del harness nativo; no se
  declara una explicación causal nueva.
- No se amplía incertidumbre, física térmica, escalas contextuales ni
  persistencia A–F. No se cambian clocks, brillo ni particiones.

### Alternatives Considered

La sonda opt-in en copia privada permite medir el contrato real y luego volver
al binario ordinario idéntico. Añadir un canal permanente de internals o cambiar
la semántica para facilitar el conductor habría ampliado indebidamente el delta.

### Identidad final, commit y checklist

- [x] Candidato completo, binarios, parches, hashes y evidencias conservados.
- [x] Identidad, puertas enfocadas y matriz anterior comprobadas/reutilizadas.
- [x] Backup recuperable, autorización fresca única y app-only verificados.
- [x] Puntos/diferencias/álgebra/errores/Ans/historial/A–F/locales/favoritos PASS.
- [x] Tiempos y 15 ciclos físicos de memoria/pila registrados.
- [x] Favoritos restaurados; ordinario sin sonda leído completo y arrancado.
- [x] Smoke ordinario A–E confirmado; vuelta normal a HOME. RAD / Español de
  España y brillo intacto se conservan desde la restauración documentada.
- [x] Exactamente las 25 rutas del manifiesto preparadas; diff --check,
  diff cached --check, stat y diff completo revisados para el único commit.

**Commit local de cierre:** `HEAD` de esta entrega, padre
`98b60786f04b152ce016f919f1bd9fe9fa88f785`, asunto exacto
`feat(units): support affine temperatures and temperature differences`.
Su SHA completo y estado Git posterior se registran después del único commit en
el [recibo final](../out/calc-units-02-temperature-closeout/final-receipt.json).
Contiene exactamente las 25 rutas del manifiesto preservado, incluidos los tres
generados. No hay correcciones runtime; solo este informe cambia respecto al
candidato recibido. Probes, capturas, backups, logs, ejecutables, out/ y
configuración ajena están excluidos. Índice vacío después del commit; el único
archivo ajeno no seguido es `docs/RESUMEN_CHAT_TOOLBOX.png`, intacto, al igual
que `.vscode/settings.json`. Sin trailers, firmas generadas ni push.

El emulador publicado y previous-program.exe permanecen intactos, con sus DLL.
El lanzador habitual pasó de nuevo 2+3=5 usando la versión publicada
(`manual-final-smoke-launcher.log`);
no se reemplazó una publicación idéntica para no desplazar la copia previa.

CALC_UNITS_02_CERRADO: SÍ
TEMPERATURA_LCD: PARCIAL
