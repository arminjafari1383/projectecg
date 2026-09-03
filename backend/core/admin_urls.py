from django.urls import path
from .admin_dashboard import admin_system_dashboard

urlpatterns = [
    path("system-dashboard/", admin_system_dashboard, name="admin-system-dashboard"),
]