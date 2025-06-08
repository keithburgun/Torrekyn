using UnityEngine;

public class CardLogic : MonoBehaviour
{
    public void PlayCard(Card card, DropZone zone)
    {
        CardData newData = GameController.game.cardDatabase.GetCardData(card.myCardData.properName);

        if (newData == null)
        {
            Debug.LogError("COULDNT FIND THAT CARD: " + card.cardName);
            return; 
        }

        if (newData.health <= 0) // is it a SPELL?
        {
            if (newData.properName == "Build")
            {
                // Build Card Played
            }
        }
    }
}
