from django.urls import path
from .views import LatestDogePriceView

urlpatterns = [
    path("dog/",LatestDogePriceView.as_view(),name="doge-price"),
]