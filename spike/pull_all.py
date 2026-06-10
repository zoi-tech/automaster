#!/usr/bin/env python3
"""Spike: extração completa de workflows + entidades de uma subconta GHL via API interna.

Uso: GHL_TOKEN=<jwt> python3 pull_all.py <locationId>
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

BACKEND = "https://backend.leadconnectorhq.com"
LOCATION = sys.argv[1] if len(sys.argv) > 1 else "WPIUKW3L4lDyMh