using UnityEngine;
using System.Collections.Generic;
using System.IO;
using System;

public class CardDatabase : MonoBehaviour
{
    public TextAsset cardCSV;

    public List<CardData> allData;

    public void InitializeAllCardDataFromCSV()
    {
        if (cardCSV != null)
        {
            StringReader reader = new StringReader(cardCSV.text);
            string line;
            bool firstLine = true;

            while ((line = reader.ReadLine()) != null)
            {
                if (firstLine)
                {
                    firstLine = false;
                    continue; // Skip the header row
                }

                string[] values = line.Split(',');
                if (values.Length == 10) // Ensure we have the correct number of columns
                {
                    CardData newCard = new CardData();
                    try
                    {
                        newCard.tier = int.Parse(values[0]);
                        newCard.faction = int.Parse(values[1]);
                        newCard.properName = values[2];
                        newCard.goldCost = int.Parse(values[3]);
                        newCard.manaCost = int.Parse(values[4]);
                        newCard.attackDamage = int.Parse(values[5]);
                        newCard.health = int.Parse(values[6]);
                        newCard.rarity = values[7];
                        newCard.description = values[8];
                        newCard.abilityType1 = (AbilityType)Enum.Parse(typeof(AbilityType), values[9]);
                        newCard.abilityType2 = AbilityType.None; // Assuming no value means None, adjust as needed

                        allData.Add(newCard);
                    }
                    catch (FormatException e)
                    {
                        Debug.LogError($"Error parsing CSV line: {line}. Error: {e.Message}");
                    }
                    catch (ArgumentException e)
                    {
                        Debug.LogError($"Error parsing AbilityType in line: {line}. Error: {e.Message}");
                    }
                }
                else
                {
                    Debug.LogError($"Incorrect number of columns in CSV line: {line}. Expected 10, found {values.Length}.");
                }
            }
        }
        else
        {
            Debug.LogError("cardCSV TextAsset is not assigned in the Inspector!");
        }
    }


    public List<CardData> GetStartingDeck()
    {
        List<CardData> startingDeck = new List<CardData>();
        startingDeck.Add(GetCard("swordsman"));
        startingDeck.Add(GetCard("swordsman"));
        startingDeck.Add(GetCard("knight"));
        startingDeck.Add(GetCard("knight"));
        startingDeck.Add(GetCard("archer"));
        startingDeck.Add(GetCard("archer"));

        return startingDeck;
    }

    public CardData GetCard(string s)
    {
        foreach (CardData card in allData)
        {
            if (card.properName.Equals(s, StringComparison.OrdinalIgnoreCase))
            {
                return card;
            }
        }
        Debug.LogError($"Card with name {s} not found in the database.");
        return null;
    }

}

