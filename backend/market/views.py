from rest_framework.response import Response
from rest_framework.views import APIView
from .models import DogePrice
from .serializers import DogePriceSerializer


class LatestDogePriceView(APIView):

    def get(self,request):

        price = DogePrice.objects.order_by("-created_at").first()

        if not price:
            return Response({
                "message":"No price data available"
            })

        serializer = DogePriceSerializer(price)

        return Response(serializer.data)