using TMPro;
using Unity.VisualScripting;
using UnityEngine;

public class Card : MonoBehaviour
{
    public TextMeshProUGUI cardName;

    public GameObject glow;
    public void Select()
    {
        glow.SetActive(true);
    }

    public void Deselect()
    {
        glow.SetActive(false);
    }

    public void Populate(CardData newCardData)
    {
        cardName.text = newCardData.properName;
    }
}
