# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for process_video.py
# Run: pyinstaller process_video.spec

import imageio_ffmpeg
import os

block_cipher = None

# Include the bundled ffmpeg binary from imageio_ffmpeg
ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
ffmpeg_binaries = [(ffmpeg_exe, 'imageio_ffmpeg/binaries')]

a = Analysis(
    ['process_video.py'],
    pathex=[],
    binaries=ffmpeg_binaries,
    datas=[],
    hiddenimports=[
        'cv2',
        'numpy',
        'numpy.core',
        'numpy.core._multiarray_umath',
        'imageio_ffmpeg',
        'requests',
        'requests.adapters',
        'requests.auth',
        'urllib3',
        'charset_normalizer',
        'certifi',
        'idna',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='process_video',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
